/**
 * Future Phase Suggestion Engine — P17.F
 *
 * Generates prioritized next-phase suggestions from reflection analysis.
 * Analyzes failure patterns, bottlenecks, and goal alignment to produce
 * ranked suggestions with rationale.
 */

import type { GoalRecord } from "../goals/types.js";
import type { FuturePhaseSuggestion, ReflectionReport } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SuggestionRankingConfig {
	/** Weight for how well a suggestion aligns with current goals (default 0.4) */
	goalAlignmentWeight: number;
	/** Weight for the severity of bottlenecks addressed (default 0.3) */
	bottleneckSeverityWeight: number;
	/** Weight for how often related failures occur (default 0.3) */
	failureFrequencyWeight: number;
	/** Maximum suggestions to return (default 3) */
	maxSuggestions: number;
}

const DEFAULT_CONFIG: SuggestionRankingConfig = {
	goalAlignmentWeight: 0.4,
	bottleneckSeverityWeight: 0.3,
	failureFrequencyWeight: 0.3,
	maxSuggestions: 3,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple cosine-similarity between two strings (word overlap).
 */
function textSimilarity(a: string, b: string): number {
	const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
	const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
	if (wordsA.size === 0 || wordsB.size === 0) return 0;
	let intersection = 0;
	for (const w of wordsA) {
		if (wordsB.has(w)) intersection++;
	}
	return intersection / Math.sqrt(wordsA.size * wordsB.size);
}

/**
 * Map a failure/error type to a fix-phase suggestion.
 */
function failureToSuggestion(failure: string, _score: number): FuturePhaseSuggestion {
	const lower = failure.toLowerCase();
	let title: string;
	let rationale: string;
	let priority: FuturePhaseSuggestion["priority"];
	let estimatedWorkstreams: number;

	if (lower.includes("timeout") || lower.includes("hang") || lower.includes("slow")) {
		title = "Performance & Stability Fix";
		rationale = `Failure "${failure}" indicates timeout or hang issues that need performance optimization.`;
		priority = "high";
		estimatedWorkstreams = 2;
	} else if (lower.includes("validation") || lower.includes("test") || lower.includes("lint")) {
		title = "Validation Pipeline Fix";
		rationale = `Failure "${failure}" indicates validation or test failures requiring pipeline improvements.`;
		priority = "critical";
		estimatedWorkstreams = 1;
	} else if (lower.includes("tool") || lower.includes("edit") || lower.includes("write")) {
		title = "Tool Execution Fix";
		rationale = `Failure "${failure}" suggests tool execution issues that need reliability improvements.`;
		priority = "critical";
		estimatedWorkstreams = 2;
	} else if (lower.includes("permission") || lower.includes("auth") || lower.includes("access")) {
		title = "Permission & Access Fix";
		rationale = `Failure "${failure}" indicates permission or access control problems.`;
		priority = "critical";
		estimatedWorkstreams = 1;
	} else if (lower.includes("network") || lower.includes("connection") || lower.includes("api")) {
		title = "Network & API Reliability Fix";
		rationale = `Failure "${failure}" suggests network or API connectivity issues.`;
		priority = "high";
		estimatedWorkstreams = 2;
	} else if (lower.includes("memory") || lower.includes("oom") || lower.includes("resource")) {
		title = "Resource Management Fix";
		rationale = `Failure "${failure}" indicates resource exhaustion or memory issues.`;
		priority = "high";
		estimatedWorkstreams = 2;
	} else {
		title = "General Robustness Fix";
		rationale = `Failure "${failure}" suggests an unresolved issue requiring investigation and fix.`;
		priority = "normal";
		estimatedWorkstreams = 1;
	}

	return {
		title,
		rationale,
		priority,
		estimatedWorkstreams,
		relatedMemoryIds: [],
		relatedObservationIds: [],
	};
}

/**
 * Map a bottleneck description to an optimization suggestion.
 */
function bottleneckToSuggestion(bottleneck: string): FuturePhaseSuggestion {
	const lower = bottleneck.toLowerCase();
	let title: string;
	let rationale: string;
	let priority: FuturePhaseSuggestion["priority"];
	let estimatedWorkstreams: number;

	if (lower.includes("queue") || lower.includes("wait") || lower.includes("scheduling")) {
		title = "Queue & Scheduling Optimization";
		rationale = `Bottleneck "${bottleneck}" indicates queuing or scheduling delays that need optimization.`;
		priority = "high";
		estimatedWorkstreams = 2;
	} else if (lower.includes("tool") || lower.includes("execution")) {
		title = "Tool Execution Optimization";
		rationale = `Bottleneck "${bottleneck}" indicates slow tool execution that needs parallelization or batching.`;
		priority = "high";
		estimatedWorkstreams = 2;
	} else if (lower.includes("retry") || lower.includes("fallback")) {
		title = "Retry Strategy Optimization";
		rationale = `Bottleneck "${bottleneck}" suggests retry/fallback overhead needs tuning.`;
		priority = "normal";
		estimatedWorkstreams = 1;
	} else if (lower.includes("validation") || lower.includes("check")) {
		title = "Validation Speed Optimization";
		rationale = `Bottleneck "${bottleneck}" indicates validation or check steps are too slow.`;
		priority = "normal";
		estimatedWorkstreams = 1;
	} else if (lower.includes("memory") || lower.includes("context") || lower.includes("prompt")) {
		title = "Context & Memory Optimization";
		rationale = `Bottleneck "${bottleneck}" suggests context or memory overhead is slowing execution.`;
		priority = "high";
		estimatedWorkstreams = 2;
	} else if (lower.includes("conflict") || lower.includes("merge")) {
		title = "Conflict Resolution Optimization";
		rationale = `Bottleneck "${bottleneck}" indicates file conflicts are causing delays.`;
		priority = "normal";
		estimatedWorkstreams = 1;
	} else {
		title = "General Performance Optimization";
		rationale = `Bottleneck "${bottleneck}" suggests a performance improvement opportunity.`;
		priority = "normal";
		estimatedWorkstreams = 1;
	}

	return {
		title,
		rationale,
		priority,
		estimatedWorkstreams,
		relatedMemoryIds: [],
		relatedObservationIds: [],
	};
}

/**
 * Map a goal to an advancement suggestion.
 */
function goalToAdvancementSuggestion(goal: GoalRecord, completedPlans: string[]): FuturePhaseSuggestion | null {
	const title = `Advance Goal: ${goal.title}`;
	const aligned = completedPlans.filter(
		(p) => textSimilarity(p, goal.title) > 0.1 || textSimilarity(p, goal.description) > 0.1,
	).length;

	let priority: FuturePhaseSuggestion["priority"];
	switch (goal.priority) {
		case "critical":
			priority = "critical";
			break;
		case "high":
			priority = "high";
			break;
		default:
			priority = "normal";
	}

	return {
		title,
		rationale: `Goal "${goal.title}" has priority ${goal.priority} and ${
			aligned > 0
				? `${aligned} completed plan(s) aligned to it. Continue advancing.`
				: "no completed plans yet aligned to it. Start working towards this goal."
		}`,
		priority,
		estimatedWorkstreams: Math.min(Math.max(Math.ceil(goal.milestones.length / 2), 1), 5),
		relatedMemoryIds: goal.relatedMemoryIds,
		relatedObservationIds: [],
	};
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface SuggestionScore {
	suggestion: FuturePhaseSuggestion;
	goalScore: number;
	bottleneckScore: number;
	failureScore: number;
	total: number;
}

function computeGoalScore(suggestion: FuturePhaseSuggestion, goals?: GoalRecord[]): number {
	if (!goals || goals.length === 0) return 0;
	let maxSimilarity = 0;
	for (const goal of goals) {
		const sim = Math.max(
			textSimilarity(suggestion.title, goal.title),
			textSimilarity(suggestion.title, goal.description),
		);
		if (sim > maxSimilarity) maxSimilarity = sim;
	}
	return maxSimilarity;
}

function computeBottleneckScore(suggestion: FuturePhaseSuggestion): number {
	if (
		suggestion.title.toLowerCase().includes("optimization") ||
		suggestion.rationale.toLowerCase().includes("bottleneck")
	) {
		return 1;
	}
	return 0;
}

function computeFailureScore(_suggestion: FuturePhaseSuggestion, scores: Map<string, number>): number {
	let totalScore = 0;
	for (const [, score] of scores) {
		totalScore += score;
	}
	return Math.min(totalScore / Math.max(scores.size, 1), 1);
}

function sortByPriority(p: FuturePhaseSuggestion["priority"]): number {
	switch (p) {
		case "critical":
			return 4;
		case "high":
			return 3;
		case "normal":
			return 2;
		case "low":
			return 1;
	}
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class FutureSuggestionEngine {
	private config: SuggestionRankingConfig;

	constructor(config?: Partial<SuggestionRankingConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	/**
	 * Generate future phase suggestions from a reflection report.
	 */
	fromReflection(report: ReflectionReport, goals?: GoalRecord[]): FuturePhaseSuggestion[] {
		const allSuggestions: FuturePhaseSuggestion[] = [];

		// 1. From failures
		if (report.whatFailed.length > 0) {
			const failureScores = this.computeFailureFrequencyScores(report);
			const fromFailures = this.fromFailures(report.whatFailed, failureScores);
			allSuggestions.push(...fromFailures);
		}

		// 2. From bottlenecks
		if (report.whatSlowedDown.length > 0) {
			const fromBottlenecks = this.fromBottlenecks(report.whatSlowedDown);
			allSuggestions.push(...fromBottlenecks);
		}

		// 3. From goals
		if (goals && goals.length > 0) {
			const fromGoals = this.fromGoals(goals, report.whatRan);
			allSuggestions.push(...fromGoals);
		}

		// 4. Rank and limit
		const ranked = this.rankSuggestions(allSuggestions, goals);
		return ranked.slice(0, this.config.maxSuggestions);
	}

	/**
	 * Generate fix suggestions from failure descriptions.
	 */
	fromFailures(failed: string[], scores: Map<string, number>): FuturePhaseSuggestion[] {
		const seen = new Set<string>();
		const suggestions: FuturePhaseSuggestion[] = [];

		for (const failure of failed) {
			const suggestion = failureToSuggestion(failure, scores.get(failure) ?? 0.5);
			const key = suggestion.title;
			if (seen.has(key)) continue;
			seen.add(key);

			// Attach failure frequency as related observation
			const freq = scores.get(failure);
			if (freq !== undefined && freq > 0.5) {
				suggestion.priority = "critical";
			}

			suggestions.push(suggestion);
		}

		return suggestions;
	}

	/**
	 * Generate optimization suggestions from bottleneck descriptions.
	 */
	fromBottlenecks(slowedDown: string[]): FuturePhaseSuggestion[] {
		const seen = new Set<string>();
		const suggestions: FuturePhaseSuggestion[] = [];

		for (const bottleneck of slowedDown) {
			const suggestion = bottleneckToSuggestion(bottleneck);
			const key = suggestion.title;
			if (seen.has(key)) continue;
			seen.add(key);
			suggestions.push(suggestion);
		}

		return suggestions;
	}

	/**
	 * Generate goal-advancement suggestions from active goals.
	 */
	fromGoals(goals: GoalRecord[], completedPlans: string[]): FuturePhaseSuggestion[] {
		const suggestions: FuturePhaseSuggestion[] = [];

		for (const goal of goals) {
			if (goal.status === "completed" || goal.status === "cancelled") continue;
			const suggestion = goalToAdvancementSuggestion(goal, completedPlans);
			if (suggestion) {
				suggestions.push(suggestion);
			}
		}

		return suggestions;
	}

	/**
	 * Rank suggestions by computed priority score.
	 */
	rankSuggestions(
		suggestions: FuturePhaseSuggestion[],
		goals?: GoalRecord[],
		failureScores?: Map<string, number>,
	): FuturePhaseSuggestion[] {
		const scored: SuggestionScore[] = suggestions.map((s) => {
			const goalScore = computeGoalScore(s, goals);
			const bottleneckScore = computeBottleneckScore(s);
			const failureScore = failureScores ? computeFailureScore(s, failureScores) : 0;

			const total =
				this.config.goalAlignmentWeight * goalScore +
				this.config.bottleneckSeverityWeight * bottleneckScore +
				this.config.failureFrequencyWeight * failureScore;

			return { suggestion: s, goalScore, bottleneckScore, failureScore, total };
		});

		// Sort by total score descending, then by priority descending
		scored.sort((a, b) => {
			const diff = b.total - a.total;
			if (Math.abs(diff) > 0.001) return diff;
			return sortByPriority(b.suggestion.priority) - sortByPriority(a.suggestion.priority);
		});

		return scored.map((s) => s.suggestion);
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	setConfig(config: Partial<SuggestionRankingConfig>): void {
		this.config = { ...this.config, ...config };
	}

	getConfig(): SuggestionRankingConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Private Helpers
	// -----------------------------------------------------------------------

	/**
	 * Compute failure frequency scores from the reflection report.
	 * Each unique failure gets a score proportional to how many times it
	 * appears and the overall failure rate.
	 */
	private computeFailureFrequencyScores(report: ReflectionReport): Map<string, number> {
		const scores = new Map<string, number>();
		const failureCount = report.whatFailed.length;
		if (failureCount === 0) return scores;

		const baseScore = Math.min(report.failureCount / Math.max(report.workspaceCount, 1), 1);
		const perFailure = baseScore / failureCount;

		for (const failure of report.whatFailed) {
			scores.set(failure, perFailure);
		}

		return scores;
	}
}

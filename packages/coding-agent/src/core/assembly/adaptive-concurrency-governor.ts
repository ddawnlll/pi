/**
 * P45.S9 — Adaptive Concurrency Governor and Backpressure Controller
 *
 * The governor is the central runtime safety mechanism for P45.
 * It samples system resources, provider limits, and queue depths,
 * then decides whether to admit, hold, reduce, or block worker admission.
 *
 * Governor signals:
 * - green: admit workers freely (within ramp limits)
 * - yellow: admit with caution, reduce parallelism
 * - red: block new worker admission, backpressure
 *
 * Backpressure sources:
 * - CPU/memory pressure
 * - LLM provider rate limits
 * - Event journal queue depth
 * - ACCP compiler queue depth
 * - Artifact acceptance queue depth
 * - Assembler queue depth
 * - Failure rate
 * - Operator visibility capacity
 */

// =============================================================================
// Types
// =============================================================================

export type GovernorSignal = "green" | "yellow" | "red";

export interface ResourceSample {
	/** CPU usage ratio (0-1). */
	cpuUsage: number;
	/** Memory usage ratio (0-1). */
	memoryUsage: number;
	/** Whether CPU pressure is high (>80%). */
	cpuPressure: boolean;
	/** Whether memory pressure is high (>85%). */
	memoryPressure: boolean;
}

export interface RateLimitSample {
	/** Current rate limit tokens remaining (0=exhausted). */
	tokensRemaining: number;
	/** Whether the rate limit is active. */
	limited: boolean;
	/** Provider name for context. */
	provider: string;
}

export interface QueueDepthSample {
	/** Event journal queue depth. */
	eventJournalDepth: number;
	/** ACCP compiler queue depth. */
	accpCompilerDepth: number;
	/** Artifact acceptance queue depth. */
	artifactAcceptanceDepth: number;
	/** Assembler queue depth. */
	assemblerDepth: number;
	/** Maximum acceptable queue depth before backpressure. */
	maxDepth: number;
}

export interface FailureRateSample {
	/** Failure rate ratio (0-1) over recent window. */
	failureRate: number;
	/** Number of failures in window. */
	failures: number;
	/** Number of operations in window. */
	total: number;
	/** Threshold for throttling. */
	throttleThreshold: number;
}

export interface GovernorInput {
	/** Resource sampling results. */
	resources: ResourceSample;
	/** LLM provider rate limit status. */
	rateLimit: RateLimitSample;
	/** Queue depth samples. */
	queues: QueueDepthSample;
	/** Failure rate sample. */
	failureRate: FailureRateSample;
	/** Whether the governor signal is stale (>30s since last sample). */
	signalStale: boolean;
	/** Current active worker count. */
	activeWorkers: number;
	/** Maximum allowed workers at current ramp tier. */
	maxWorkersAtTier: number;
	/** Operator visibility capacity remaining. */
	operatorVisibilityRemaining: number;
	/** Timestamp of last sample. */
	lastSampleAt: string;
}

export interface GovernorVerdict {
	/** Current governor signal. */
	signal: GovernorSignal;
	/** Whether a new worker can be admitted. */
	canAdmit: boolean;
	/** Recommended worker count adjustment. */
	recommendedWorkers: number;
	/** Whether backpressure should be applied. */
	applyBackpressure: boolean;
	/** Blocking reasons if cannot admit. */
	blockingReasons: string[];
	/** Warnings (advisory only). */
	warnings: string[];
	/** Detailed per-source status. */
	sourceStatus: GovernorSourceStatus;
}

export interface GovernorSourceStatus {
	resources: { signal: GovernorSignal; detail: string };
	rateLimit: { signal: GovernorSignal; detail: string };
	queues: { signal: GovernorSignal; detail: string };
	failureRate: { signal: GovernorSignal; detail: string };
	stale: { signal: GovernorSignal; detail: string };
	operatorVisibility: { signal: GovernorSignal; detail: string };
}

export interface GovernorConfig {
	/** CPU threshold for yellow signal (default: 0.60). */
	cpuYellowThreshold: number;
	/** CPU threshold for red signal (default: 0.80). */
	cpuRedThreshold: number;
	/** Memory threshold for yellow (default: 0.70). */
	memoryYellowThreshold: number;
	/** Memory threshold for red (default: 0.85). */
	memoryRedThreshold: number;
	/** Queue depth ratio for yellow (default: 0.5). */
	queueYellowRatio: number;
	/** Queue depth ratio for red (default: 0.8). */
	queueRedRatio: number;
	/** Failure rate for yellow (default: 0.10). */
	failureRateYellowThreshold: number;
	/** Failure rate for red (default: 0.25). */
	failureRateRedThreshold: number;
	/** Max signal age in ms before considered stale (default: 30_000). */
	maxSignalAgeMs: number;
}

// =============================================================================
// Default Config
// =============================================================================

export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
	cpuYellowThreshold: 0.6,
	cpuRedThreshold: 0.8,
	memoryYellowThreshold: 0.7,
	memoryRedThreshold: 0.85,
	queueYellowRatio: 0.5,
	queueRedRatio: 0.8,
	failureRateYellowThreshold: 0.1,
	failureRateRedThreshold: 0.25,
	maxSignalAgeMs: 30_000,
};

// =============================================================================
// Governor
// =============================================================================

/**
 * Evaluate governor signal from all input sources.
 * Fail-closed: if signal is stale, treat as red.
 */
export function evaluateGovernor(
	input: GovernorInput,
	config: GovernorConfig = DEFAULT_GOVERNOR_CONFIG,
): GovernorVerdict {
	const blockingReasons: string[] = [];
	const warnings: string[] = [];

	// Stale signal check — fail-closed
	const staleSignal: GovernorSignal = input.signalStale ? "red" : "green";
	const staleDetail = input.signalStale ? `Signal is stale (age > ${config.maxSignalAgeMs}ms)` : "Signal is fresh";

	if (input.signalStale) {
		blockingReasons.push("Governor signal is stale — blocking admission");
	}

	// Resource pressure
	const resourceSignal = evaluateResourcePressure(input.resources, config);
	const resourceDetail = buildResourceDetail(input.resources);

	if (resourceSignal === "red") {
		blockingReasons.push("Resource pressure is red");
	}

	// Rate limit
	const rateLimitSignal = evaluateRateLimit(input.rateLimit);
	const rateLimitDetail = input.rateLimit.limited
		? `LLM provider ${input.rateLimit.provider} rate limited (tokens: ${input.rateLimit.tokensRemaining})`
		: `LLM provider ${input.rateLimit.provider} OK`;

	if (rateLimitSignal === "red") {
		blockingReasons.push("LLM provider rate limit exhausted — blocking admission");
	}

	// Queue depth
	const queueSignal = evaluateQueueDepth(input.queues, config);
	const queueDetail = buildQueueDetail(input.queues);

	if (queueSignal === "red") {
		blockingReasons.push("Queue depth exceeded red threshold — applying backpressure");
	}

	// Failure rate
	const failureSignal = evaluateFailureRate(input.failureRate, config);
	const failureDetail = `Failure rate: ${(input.failureRate.failureRate * 100).toFixed(1)}% (${input.failureRate.failures}/${input.failureRate.total})`;

	if (failureSignal === "red") {
		blockingReasons.push(`Failure rate ${(input.failureRate.failureRate * 100).toFixed(1)}% exceeds red threshold`);
	}

	// Operator visibility capacity
	const operatorSignal: GovernorSignal = input.operatorVisibilityRemaining < 0 ? "red" : "green";
	const operatorDetail =
		input.operatorVisibilityRemaining < 0
			? "Operator visibility capacity exceeded"
			: `Operator visibility capacity OK (${input.operatorVisibilityRemaining} remaining)`;

	if (operatorSignal === "red") {
		blockingReasons.push("Operator visibility capacity exceeded");
	}

	// Determine overall signal (least-common-denominator, fail-closed)
	const signals: GovernorSignal[] = [
		staleSignal,
		resourceSignal,
		rateLimitSignal,
		queueSignal,
		failureSignal,
		operatorSignal,
	];

	const overallSignal = computeOverallSignal(signals);

	// Determine admission
	const canAdmit = overallSignal === "green" && blockingReasons.length === 0;
	const applyBackpressure = overallSignal !== "green";

	// Recommended workers
	let recommendedWorkers: number;
	if (overallSignal === "red") {
		recommendedWorkers = 0;
	} else if (overallSignal === "yellow") {
		recommendedWorkers = Math.max(1, Math.floor(input.maxWorkersAtTier * 0.5));
	} else {
		recommendedWorkers = Math.min(input.activeWorkers + 1, input.maxWorkersAtTier);
	}

	return {
		signal: overallSignal,
		canAdmit,
		recommendedWorkers,
		applyBackpressure,
		blockingReasons,
		warnings,
		sourceStatus: {
			resources: { signal: resourceSignal, detail: resourceDetail },
			rateLimit: { signal: rateLimitSignal, detail: rateLimitDetail },
			queues: { signal: queueSignal, detail: queueDetail },
			failureRate: { signal: failureSignal, detail: failureDetail },
			stale: { signal: staleSignal, detail: staleDetail },
			operatorVisibility: { signal: operatorSignal, detail: operatorDetail },
		},
	};
}

// =============================================================================
// Per-source Evaluators
// =============================================================================

function evaluateResourcePressure(resources: ResourceSample, config: GovernorConfig): GovernorSignal {
	if (resources.cpuUsage >= config.cpuRedThreshold || resources.memoryUsage >= config.memoryRedThreshold) {
		return "red";
	}
	if (resources.cpuUsage >= config.cpuYellowThreshold || resources.memoryUsage >= config.memoryYellowThreshold) {
		return "yellow";
	}
	return "green";
}

function evaluateRateLimit(rateLimit: RateLimitSample): GovernorSignal {
	if (rateLimit.tokensRemaining <= 0) return "red";
	if (rateLimit.tokensRemaining < 10) return "yellow";
	return "green";
}

function evaluateQueueDepth(queues: QueueDepthSample, config: GovernorConfig): GovernorSignal {
	const maxQueue = Math.max(
		queues.eventJournalDepth,
		queues.accpCompilerDepth,
		queues.artifactAcceptanceDepth,
		queues.assemblerDepth,
	);
	const ratio = queues.maxDepth > 0 ? maxQueue / queues.maxDepth : 0;

	if (ratio >= config.queueRedRatio) return "red";
	if (ratio >= config.queueYellowRatio) return "yellow";
	return "green";
}

function evaluateFailureRate(failureRate: FailureRateSample, config: GovernorConfig): GovernorSignal {
	if (failureRate.failureRate >= config.failureRateRedThreshold) return "red";
	if (failureRate.failureRate >= config.failureRateYellowThreshold) return "yellow";
	return "green";
}

function computeOverallSignal(signals: GovernorSignal[]): GovernorSignal {
	if (signals.includes("red")) return "red";
	if (signals.includes("yellow")) return "yellow";
	return "green";
}

// =============================================================================
// Detail Builders
// =============================================================================

function buildResourceDetail(resources: ResourceSample): string {
	const parts: string[] = [];
	parts.push(`CPU: ${(resources.cpuUsage * 100).toFixed(0)}%`);
	parts.push(`Memory: ${(resources.memoryUsage * 100).toFixed(0)}%`);
	if (resources.cpuPressure) parts.push("CPU pressure HIGH");
	if (resources.memoryPressure) parts.push("Memory pressure HIGH");
	return parts.join(", ");
}

function buildQueueDetail(queues: QueueDepthSample): string {
	return [
		`EventJournal: ${queues.eventJournalDepth}/${queues.maxDepth}`,
		`ACCPCompiler: ${queues.accpCompilerDepth}/${queues.maxDepth}`,
		`ArtifactAcceptance: ${queues.artifactAcceptanceDepth}/${queues.maxDepth}`,
		`Assembler: ${queues.assemblerDepth}/${queues.maxDepth}`,
	].join(", ");
}

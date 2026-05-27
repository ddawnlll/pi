/**
 * Worker Loop Prevention — 25.R
 *
 * Detects and prevents brain workers from entering execution loops.
 * A loop occurs when a worker repeatedly performs the same or very
 * similar task without making progress toward a different outcome.
 *
 * Detection strategies:
 * 1. **Content dedup** — Exact or fuzzy match of task content within a window.
 * 2. **Cycle detection** — Same signature observed N times consecutively.
 * 3. **Stall detection** — No meaningful progress (no new evidence, outputs,
 *    or state changes) across M consecutive cycles.
 * 4. **Recursion depth** — Prevents autonomous worker re-invocation beyond
 *    a configurable depth limit.
 *
 * Every loop detection event produces an evidence-backed diagnostic with
 * relevant context for downstream observability and debugging.
 *
 * Dependencies: ../types.ts (WorkerDiagnostic, WorkerStopCondition)
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import { createWorkerDiagnostic, type WorkerDiagnostic, type WorkerStopCondition } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum entries in the cycle signature history per worker. */
const MAX_CYCLE_HISTORY = 50;

/** Maximum entries in the stall evidence log per worker. */
const MAX_STALL_EVIDENCE = 20;

// ---------------------------------------------------------------------------
// Loop Prevention Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for loop prevention.
 *
 * Sensible defaults are provided for all values. Adjust based on
 * worker role sensitivity and operational requirements.
 */
export interface LoopPreventionConfig {
	/**
	 * Whether loop detection is enabled globally.
	 * Default: true.
	 */
	enabled: boolean;

	/**
	 * Maximum number of identical consecutive cycle signatures before
	 * the worker is flagged as looping.
	 * Default: 5 (five identical cycles = loop).
	 */
	maxConsecutiveIdenticalCycles: number;

	/**
	 * Maximum number of consecutive cycles with no new evidence or
	 * outputs before the worker is flagged as stalled.
	 * Default: 8 (eight cycles with no progress = stall).
	 */
	maxConsecutiveStalledCycles: number;

	/**
	 * Maximum recursion depth for autonomous worker re-invocation.
	 * Prevents a worker from recursively triggering itself or others
	 * beyond this depth.
	 * Default: 3.
	 */
	maxRecursionDepth: number;

	/**
	 * Window in milliseconds for content deduplication.
	 * If identical content appears within this window, it's a loop.
	 * Default: 300_000 (5 minutes).
	 */
	dedupWindowMs: number;

	/**
	 * Whether to enable similarity-based content matching (fuzzy dedup).
	 * Default: true.
	 */
	enableSimilarityMatching: boolean;

	/**
	 * Similarity threshold (0-1) for fuzzy matching when
	 * enableSimilarityMatching is true.
	 * Default: 0.85.
	 */
	similarityThreshold: number;

	/**
	 * Whether the loop prevention system should auto-stop the worker
	 * when a loop is detected. If false, only diagnostics are emitted
	 * but no forced transition occurs.
	 * Default: true.
	 */
	autoStopOnLoop: boolean;
}

/**
 * Default loop prevention configuration.
 */
export const DEFAULT_LOOP_PREVENTION_CONFIG: LoopPreventionConfig = {
	enabled: true,
	maxConsecutiveIdenticalCycles: 5,
	maxConsecutiveStalledCycles: 8,
	maxRecursionDepth: 3,
	dedupWindowMs: 300_000,
	enableSimilarityMatching: true,
	similarityThreshold: 0.85,
	autoStopOnLoop: true,
};

// ---------------------------------------------------------------------------
// Loop Detection Result
// ---------------------------------------------------------------------------

/**
 * Result of a loop detection check.
 */
export interface LoopDetectionResult {
	/** Whether a loop or stall was detected. */
	detected: boolean;
	/** The type of loop condition detected, if any. */
	condition?: "content_loop" | "cycle_loop" | "stall" | "recursion_exceeded";
	/** Human-readable description of what was detected. */
	message: string;
	/** Evidence-backed diagnostic with relevant context. */
	diagnostic?: WorkerDiagnostic;
	/** The stop condition associated with this detection. */
	stopCondition?: WorkerStopCondition;
}

// ---------------------------------------------------------------------------
// Cycle Signature
// ---------------------------------------------------------------------------

/**
 * A cycle signature records the content and outcome of one work cycle
 * for loop detection analysis.
 */
export interface CycleSignature {
	/** ISO 8601 timestamp of when the cycle was recorded. */
	timestamp: string;
	/** SHA-256 hash of the task content. */
	contentHash: string;
	/** The original task content (for similarity matching). */
	content: string;
	/** The outcome/result of the cycle. */
	outcome: string;
	/** Whether the cycle produced any new evidence or outputs. */
	producedEvidence: boolean;
	/** Optional context about the cycle. */
	context: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Recursion Tracking
// ---------------------------------------------------------------------------

/**
 * Tracks invocation depth for a chain of worker executions.
 */
export interface RecursionFrame {
	/** Worker ID that is being invoked. */
	workerId: string;
	/** The role of the worker being invoked. */
	role: string;
	/** ISO 8601 timestamp of the invocation. */
	timestamp: string;
	/** A description of why this worker was re-invoked. */
	reason: string;
}

// ---------------------------------------------------------------------------
// Loop Prevention Engine
// ---------------------------------------------------------------------------

/**
 * Engine for detecting and preventing worker execution loops.
 *
 * Maintains per-worker cycle history, stall evidence, and recursion
 * tracking. Provides methods to check for loop conditions at each
 * stage of the worker lifecycle.
 *
 * Usage:
 * ```typescript
 * const engine = new LoopPreventionEngine();
 *
 * // Record each cycle's signature
 * engine.recordCycle(workerId, signature);
 *
 * // Before starting a new cycle, check for loops
 * const result = engine.checkForLoop(workerId);
 * if (result.detected) {
 *   // Take corrective action (stop worker, notify supervisor, etc.)
 * }
 *
 * // Track recursion depth for autonomous re-invocation
 * engine.pushRecursionFrame(workerId, frame);
 * const depth = engine.getRecursionDepth(workerId);
 * ```
 */
export class LoopPreventionEngine {
	private config: LoopPreventionConfig;
	private cycleHistory: Map<string, CycleSignature[]>;
	private stallEvidence: Map<string, string[]>;
	private recursionStack: Map<string, RecursionFrame[]>;

	/**
	 * Create a new LoopPreventionEngine.
	 *
	 * @param config - Optional partial configuration. Missing keys use defaults.
	 */
	constructor(config?: Partial<LoopPreventionConfig>) {
		this.config = {
			enabled: config?.enabled ?? DEFAULT_LOOP_PREVENTION_CONFIG.enabled,
			maxConsecutiveIdenticalCycles:
				config?.maxConsecutiveIdenticalCycles ?? DEFAULT_LOOP_PREVENTION_CONFIG.maxConsecutiveIdenticalCycles,
			maxConsecutiveStalledCycles:
				config?.maxConsecutiveStalledCycles ?? DEFAULT_LOOP_PREVENTION_CONFIG.maxConsecutiveStalledCycles,
			maxRecursionDepth: config?.maxRecursionDepth ?? DEFAULT_LOOP_PREVENTION_CONFIG.maxRecursionDepth,
			dedupWindowMs: config?.dedupWindowMs ?? DEFAULT_LOOP_PREVENTION_CONFIG.dedupWindowMs,
			enableSimilarityMatching:
				config?.enableSimilarityMatching ?? DEFAULT_LOOP_PREVENTION_CONFIG.enableSimilarityMatching,
			similarityThreshold: config?.similarityThreshold ?? DEFAULT_LOOP_PREVENTION_CONFIG.similarityThreshold,
			autoStopOnLoop: config?.autoStopOnLoop ?? DEFAULT_LOOP_PREVENTION_CONFIG.autoStopOnLoop,
		};
		this.cycleHistory = new Map();
		this.stallEvidence = new Map();
		this.recursionStack = new Map();
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Get a snapshot of the current configuration.
	 */
	getConfig(): LoopPreventionConfig {
		return { ...this.config };
	}

	/**
	 * Update configuration. Only provided fields are changed.
	 */
	setConfig(config: Partial<LoopPreventionConfig>): void {
		if (config.enabled !== undefined) this.config.enabled = config.enabled;
		if (config.maxConsecutiveIdenticalCycles !== undefined)
			this.config.maxConsecutiveIdenticalCycles = config.maxConsecutiveIdenticalCycles;
		if (config.maxConsecutiveStalledCycles !== undefined)
			this.config.maxConsecutiveStalledCycles = config.maxConsecutiveStalledCycles;
		if (config.maxRecursionDepth !== undefined) this.config.maxRecursionDepth = config.maxRecursionDepth;
		if (config.dedupWindowMs !== undefined) this.config.dedupWindowMs = config.dedupWindowMs;
		if (config.enableSimilarityMatching !== undefined)
			this.config.enableSimilarityMatching = config.enableSimilarityMatching;
		if (config.similarityThreshold !== undefined) this.config.similarityThreshold = config.similarityThreshold;
		if (config.autoStopOnLoop !== undefined) this.config.autoStopOnLoop = config.autoStopOnLoop;
	}

	// -----------------------------------------------------------------------
	// Content Hashing
	// -----------------------------------------------------------------------

	/**
	 * Compute a SHA-256 hash of content for dedup comparison.
	 */
	private computeHash(content: string): string {
		return createHash("sha256").update(content).digest("hex");
	}

	/**
	 * Compute a simple similarity score between two strings (0-1).
	 *
	 * Uses Jaccard similarity on word-level shingles for a reasonable
	 * fuzzy match without external dependencies.
	 */
	private computeSimilarity(a: string, b: string): number {
		const getShingles = (s: string): Set<string> => {
			const words = s.toLowerCase().split(/\s+/);
			const shingles = new Set<string>();
			for (let i = 0; i < words.length - 1; i++) {
				shingles.add(`${words[i]}_${words[i + 1]}`);
			}
			return shingles;
		};

		const setA = getShingles(a);
		const setB = getShingles(b);

		if (setA.size === 0 && setB.size === 0) return 1.0;
		if (setA.size === 0 || setB.size === 0) return 0.0;

		// Intersection size
		let intersection = 0;
		for (const item of setA) {
			if (setB.has(item)) intersection++;
		}

		// Union size
		const union = setA.size + setB.size - intersection;

		return union > 0 ? intersection / union : 1.0;
	}

	// -----------------------------------------------------------------------
	// Cycle Recording
	// -----------------------------------------------------------------------

	/**
	 * Record a cycle signature for a worker.
	 *
	 * This is called after each work cycle completes to build up
	 * the history used for loop detection.
	 *
	 * @param workerId - The ID of the worker.
	 * @param signature - The cycle signature to record.
	 */
	recordCycle(workerId: string, signature: Omit<CycleSignature, "contentHash"> & { contentHash?: string }): void {
		const history = this.cycleHistory.get(workerId) ?? [];

		const entry: CycleSignature = {
			...signature,
			contentHash: signature.contentHash ?? this.computeHash(signature.content),
		};

		history.unshift(entry);

		if (history.length > MAX_CYCLE_HISTORY) {
			history.length = MAX_CYCLE_HISTORY;
		}

		this.cycleHistory.set(workerId, history);
	}

	/**
	 * Get the cycle history for a worker.
	 *
	 * @param workerId - The worker's ID.
	 * @returns Array of cycle signatures (most recent first), or empty array.
	 */
	getCycleHistory(workerId: string): CycleSignature[] {
		return this.cycleHistory.get(workerId) ?? [];
	}

	/**
	 * Get the stall evidence log for a worker.
	 *
	 * @param workerId - The worker's ID.
	 * @returns Array of stall evidence messages (most recent first), or empty array.
	 */
	getStallEvidence(workerId: string): string[] {
		return this.stallEvidence.get(workerId) ?? [];
	}

	/**
	 * Record stall evidence for a worker.
	 *
	 * @param workerId - The ID of the worker.
	 * @param evidence - Description of why the cycle is considered stalled.
	 */
	recordStallEvidence(workerId: string, evidence: string): void {
		const log = this.stallEvidence.get(workerId) ?? [];
		log.unshift(evidence);
		if (log.length > MAX_STALL_EVIDENCE) {
			log.length = MAX_STALL_EVIDENCE;
		}
		this.stallEvidence.set(workerId, log);
	}

	/**
	 * Clear cycle history for a worker (e.g., after a successful outcome).
	 *
	 * @param workerId - The ID of the worker.
	 */
	clearHistory(workerId: string): void {
		this.cycleHistory.delete(workerId);
		this.stallEvidence.delete(workerId);
	}

	// -----------------------------------------------------------------------
	// Loop Detection
	// -----------------------------------------------------------------------

	/**
	 * Check for content-based loop: identical task content appearing
	 * repeatedly within the dedup window.
	 *
	 * @param workerId - The ID of the worker.
	 * @param content - The current task content to check.
	 * @returns A LoopDetectionResult if a content loop is detected.
	 */
	checkContentLoop(workerId: string, content: string): LoopDetectionResult {
		if (!this.config.enabled) {
			return { detected: false, message: "Loop prevention is disabled" };
		}

		const history = this.cycleHistory.get(workerId) ?? [];
		if (history.length < this.config.maxConsecutiveIdenticalCycles) {
			return { detected: false, message: "Insufficient history for loop detection" };
		}

		const currentHash = this.computeHash(content);
		const now = Date.now();

		// Count consecutive identical content hashes within the dedup window
		let consecutiveCount = 0;
		let earliestMatch: CycleSignature | undefined;

		for (const entry of history) {
			const age = now - new Date(entry.timestamp).getTime();
			if (age > this.config.dedupWindowMs) break; // Outside window, stop checking

			const isMatch =
				entry.contentHash === currentHash ||
				(this.config.enableSimilarityMatching &&
					this.computeSimilarity(entry.content, content) >= this.config.similarityThreshold);

			if (isMatch) {
				consecutiveCount++;
				if (!earliestMatch) earliestMatch = entry;
			} else {
				break; // Consecutive chain broken
			}
		}

		if (consecutiveCount >= this.config.maxConsecutiveIdenticalCycles) {
			const diagnostic = createWorkerDiagnostic(
				"dag_validation_failed",
				`Content loop detected: ${consecutiveCount} consecutive identical cycles within dedup window`,
				{
					consecutiveCount,
					maxConsecutiveIdenticalCycles: this.config.maxConsecutiveIdenticalCycles,
					dedupWindowMs: this.config.dedupWindowMs,
					firstOccurrence: earliestMatch?.timestamp,
				},
				[`cycle:${workerId}`],
			);

			return {
				detected: true,
				condition: "content_loop",
				message: diagnostic.message,
				diagnostic,
				stopCondition: "dag_validation_failed",
			};
		}

		return { detected: false, message: "No content loop detected" };
	}

	/**
	 * Check for cycle-based loop: same cycle outcome/signature observed
	 * N times consecutively, indicating the worker is stuck in a pattern.
	 *
	 * @param workerId - The ID of the worker.
	 * @returns A LoopDetectionResult if a cycle loop is detected.
	 */
	checkCycleLoop(workerId: string): LoopDetectionResult {
		if (!this.config.enabled) {
			return { detected: false, message: "Loop prevention is disabled" };
		}

		const history = this.cycleHistory.get(workerId) ?? [];
		if (history.length < this.config.maxConsecutiveIdenticalCycles) {
			return { detected: false, message: "Insufficient history for cycle loop detection" };
		}

		const window = history.slice(0, this.config.maxConsecutiveIdenticalCycles);

		// Check if all recent cycles have the same outcome string
		const firstOutcome = window[0].outcome;
		const allSameOutcome = window.every((entry) => entry.outcome === firstOutcome);

		if (allSameOutcome && window.length >= this.config.maxConsecutiveIdenticalCycles) {
			const diagnostic = createWorkerDiagnostic(
				"dag_validation_failed",
				`Cycle loop detected: ${window.length} consecutive cycles with identical outcome "${firstOutcome}"`,
				{
					consecutiveOutcomes: window.length,
					outcome: firstOutcome,
					maxConsecutiveIdenticalCycles: this.config.maxConsecutiveIdenticalCycles,
					cycleRange: {
						from: window[window.length - 1]?.timestamp,
						to: window[0]?.timestamp,
					},
				},
				[`cycle:${workerId}`],
			);

			return {
				detected: true,
				condition: "cycle_loop",
				message: diagnostic.message,
				diagnostic,
				stopCondition: "dag_validation_failed",
			};
		}

		return { detected: false, message: "No cycle loop detected" };
	}

	/**
	 * Check for stall: consecutive cycles with no new evidence or outputs.
	 *
	 * @param workerId - The ID of the worker.
	 * @returns A LoopDetectionResult if a stall is detected.
	 */
	checkStall(workerId: string): LoopDetectionResult {
		if (!this.config.enabled) {
			return { detected: false, message: "Loop prevention is disabled" };
		}

		const history = this.cycleHistory.get(workerId) ?? [];
		if (history.length < this.config.maxConsecutiveStalledCycles) {
			return { detected: false, message: "Insufficient history for stall detection" };
		}

		const window = history.slice(0, this.config.maxConsecutiveStalledCycles);
		const stalledCount = window.filter((entry) => !entry.producedEvidence).length;

		if (stalledCount >= this.config.maxConsecutiveStalledCycles) {
			const diagnostic = createWorkerDiagnostic(
				"dag_validation_failed",
				`Worker stall detected: ${stalledCount} consecutive cycles with no new evidence`,
				{
					stalledCount,
					maxConsecutiveStalledCycles: this.config.maxConsecutiveStalledCycles,
					totalRecentCycles: window.length,
					stallEvidence: this.stallEvidence.get(workerId) ?? [],
				},
				[`stall:${workerId}`],
			);

			return {
				detected: true,
				condition: "stall",
				message: diagnostic.message,
				diagnostic,
				stopCondition: "dag_validation_failed",
			};
		}

		return { detected: false, message: "No stall detected" };
	}

	/**
	 * Run all loop detection checks for a worker.
	 *
	 * This is the recommended entry point. It checks content loops,
	 * cycle loops, and stalls in order, returning the first detection.
	 *
	 * @param workerId - The ID of the worker.
	 * @param content - The current task content (for content loop check).
	 * @returns The first LoopDetectionResult if any detection occurs.
	 */
	checkForLoop(workerId: string, content?: string): LoopDetectionResult {
		if (!this.config.enabled) {
			return { detected: false, message: "Loop prevention is disabled" };
		}

		// Check content-based loop if content is provided
		if (content !== undefined) {
			const contentResult = this.checkContentLoop(workerId, content);
			if (contentResult.detected) return contentResult;
		}

		// Check cycle-based loop
		const cycleResult = this.checkCycleLoop(workerId);
		if (cycleResult.detected) return cycleResult;

		// Check for stall
		const stallResult = this.checkStall(workerId);
		if (stallResult.detected) return stallResult;

		return { detected: false, message: "No loop conditions detected" };
	}

	// -----------------------------------------------------------------------
	// Recursion Depth Tracking
	// -----------------------------------------------------------------------

	/**
	 * Push a recursion frame onto the stack.
	 *
	 * Used when a worker autonomously invokes itself or another worker.
	 * The frame is pushed before execution and should be popped after
	 * the invocation completes.
	 *
	 * @param workerId - The ID of the worker initiating the invocation.
	 * @param frame - The recursion frame describing the invocation.
	 * @throws If the recursion depth would exceed maxRecursionDepth.
	 */
	pushRecursionFrame(workerId: string, frame: RecursionFrame): void {
		const stack = this.recursionStack.get(workerId) ?? [];
		stack.push(frame);
		this.recursionStack.set(workerId, stack);

		if (stack.length > this.config.maxRecursionDepth) {
			throw new Error(
				`Recursion depth exceeded for worker '${workerId}': ${stack.length} > ${this.config.maxRecursionDepth}. ` +
					`Chain: ${stack.map((f) => `${f.workerId} (${f.role})`).join(" -> ")}`,
			);
		}
	}

	/**
	 * Pop the most recent recursion frame from the stack.
	 *
	 * @param workerId - The ID of the worker.
	 */
	popRecursionFrame(workerId: string): void {
		const stack = this.recursionStack.get(workerId);
		if (stack && stack.length > 0) {
			stack.pop();
			if (stack.length === 0) {
				this.recursionStack.delete(workerId);
			}
		}
	}

	/**
	 * Get the current recursion depth for a worker.
	 *
	 * @param workerId - The ID of the worker.
	 * @returns The current recursion depth (0 if no active chain).
	 */
	getRecursionDepth(workerId: string): number {
		return this.recursionStack.get(workerId)?.length ?? 0;
	}

	/**
	 * Get the full recursion stack for a worker.
	 *
	 * @param workerId - The ID of the worker.
	 * @returns Array of recursion frames (most recent last), or empty array.
	 */
	getRecursionStack(workerId: string): RecursionFrame[] {
		return this.recursionStack.get(workerId) ?? [];
	}

	/**
	 * Check if a new invocation would exceed the max recursion depth.
	 *
	 * @param workerId - The ID of the worker.
	 * @returns A LoopDetectionResult if depth would be exceeded.
	 */
	checkRecursionDepth(workerId: string): LoopDetectionResult {
		if (!this.config.enabled) {
			return { detected: false, message: "Loop prevention is disabled" };
		}

		const currentDepth = this.getRecursionDepth(workerId);
		if (currentDepth >= this.config.maxRecursionDepth) {
			const diagnostic = createWorkerDiagnostic(
				"dag_validation_failed",
				`Recursion depth exceeded: ${currentDepth} >= ${this.config.maxRecursionDepth}`,
				{
					currentDepth,
					maxRecursionDepth: this.config.maxRecursionDepth,
					stack: this.recursionStack.get(workerId)?.map((f) => ({
						workerId: f.workerId,
						role: f.role,
						reason: f.reason,
					})),
				},
				[`recursion:${workerId}`],
			);

			return {
				detected: true,
				condition: "recursion_exceeded",
				message: diagnostic.message,
				diagnostic,
				stopCondition: "dag_validation_failed",
			};
		}

		return { detected: false, message: "Recursion depth OK" };
	}
}

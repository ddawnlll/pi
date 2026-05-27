/**
 * Brain Worker Lifecycle Engine — 25.C
 *
 * Manages worker lifecycle state transitions with policy rules,
 * budget enforcement, cooldown management, deduplication, and
 * stop-condition handling.
 *
 * The lifecycle engine enforces policy constraints such as minimum
 * cooldown periods, maximum consecutive failures, and runtime budgets.
 * Every state transition emits a WorkerTransition event that can be
 * consumed via the onTransition callback for audit logging and
 * downstream processing.
 *
 * File scope: This is the single lifecycle management implementation
 * for all brain worker state transitions.
 *
 * Dependencies: ./types.ts (WorkerManifest, WorkerStatus, WorkerLifecycleState, etc.)
 */

import { createHash } from "node:crypto";
import {
	createWorkerCooldown,
	createWorkerDiagnostic,
	DEFAULT_WORKER_DEDUP_CONFIG,
	OPERATIONAL_STATES,
	type WorkerDedupConfig,
	type WorkerDiagnostic,
	type WorkerLifecycleState,
	type WorkerManifest,
	type WorkerStatus,
	type WorkerStopCondition,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of recent diagnostics to retain. */
const MAX_DIAGNOSTICS = 20;

/** Maximum number of dedup history entries to retain. */
const MAX_DEDUP_HISTORY = 100;

// ---------------------------------------------------------------------------
// Lifecycle Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the Worker Lifecycle Engine.
 *
 * All values have sensible defaults suitable for most use cases.
 */
export interface LifecycleConfig {
	/**
	 * Whether to automatically transition workers from dormant to standby
	 * when they are first registered. Default: true.
	 */
	autoActivateOnRegister: boolean;

	/**
	 * Whether to enforce budget limits (token cap, runtime cap).
	 * If false, budget constraints are advisory only. Default: true.
	 */
	enforceBudgets: boolean;

	/**
	 * Whether to enforce cooldown periods after work cycles.
	 * If false, workers can immediately accept new work. Default: true.
	 */
	enforceCooldowns: boolean;

	/**
	 * Whether deduplication is enabled globally.
	 * Can be overridden per-worker via WorkerDedupConfig. Default: true.
	 */
	enableDeduplication: boolean;

	/**
	 * Default dedup configuration for workers that don't specify one.
	 */
	defaultDedupConfig: WorkerDedupConfig;
}

/**
 * Default lifecycle configuration.
 */
export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
	autoActivateOnRegister: true,
	enforceBudgets: true,
	enforceCooldowns: true,
	enableDeduplication: true,
	defaultDedupConfig: { ...DEFAULT_WORKER_DEDUP_CONFIG },
};

// ---------------------------------------------------------------------------
// Lifecycle Transition Event
// ---------------------------------------------------------------------------

/**
 * A recorded state transition for a brain worker.
 *
 * Every time a worker changes lifecycle state through the engine,
 * a WorkerTransition event is produced.
 */
export interface WorkerTransition {
	/** The ID of the worker that transitioned. */
	workerId: string;

	/** The lifecycle state before the transition. */
	fromState: WorkerLifecycleState;

	/** The lifecycle state after the transition. */
	toState: WorkerLifecycleState;

	/** Human-readable reason for the transition. */
	reason: string;

	/** What triggered this transition. */
	triggeredBy: "system" | "user" | "policy" | "budget" | "stop_condition";

	/** ISO 8601 timestamp of when the transition occurred. */
	timestamp: string;

	/** Optional diagnostic attached to the transition. */
	diagnostic?: WorkerDiagnostic;
}

// ---------------------------------------------------------------------------
// Valid Transition Map
// ---------------------------------------------------------------------------

/**
 * Defines which lifecycle states a worker can transition from
 * for each target state.
 *
 * The map is structured as:
 *   transitions[targetState] = Set<sourceStates>
 */
const ALLOWED_TRANSITIONS: Record<WorkerLifecycleState, Set<WorkerLifecycleState>> = {
	dormant: new Set<WorkerLifecycleState>(["standby", "paused", "retired", "failed"]),
	standby: new Set<WorkerLifecycleState>(["dormant", "active", "busy", "cooling", "paused", "retired", "failed"]),
	active: new Set<WorkerLifecycleState>(["standby", "busy", "cooling"]),
	busy: new Set<WorkerLifecycleState>(["active", "standby", "cooling", "failed"]),
	cooling: new Set<WorkerLifecycleState>(["active", "busy", "standby"]),
	paused: new Set<WorkerLifecycleState>(["standby", "active", "busy", "cooling", "failed"]),
	retired: new Set<WorkerLifecycleState>(["dormant", "standby", "active", "busy", "cooling", "paused", "failed"]),
	failed: new Set<WorkerLifecycleState>(["standby", "active", "busy", "cooling", "paused"]),
};

// ---------------------------------------------------------------------------
// Deduplication History Entry
// ---------------------------------------------------------------------------

/**
 * An entry in the deduplication history log.
 */
export interface DedupHistoryEntry {
	/** Content hash of the task that was deduped. */
	taskHash: string;
	/** ISO 8601 timestamp when the task was originally submitted. */
	originalTimestamp: string;
	/** ISO 8601 timestamp when the duplicate was suppressed. */
	suppressedAt: string;
	/** Reason for suppression. */
	reason: "exact_match" | "similarity_match" | "cooldown_active";
}

// ---------------------------------------------------------------------------
// Worker Lifecycle Engine
// ---------------------------------------------------------------------------

/**
 * Engine for managing brain worker lifecycle state transitions.
 *
 * The engine enforces policy rules, validates transitions, manages
 * budgets and cooldowns, handles deduplication, and emits events
 * for every state change.
 *
 * Usage:
 * ```typescript
 * const engine = new WorkerLifecycleEngine();
 *
 * // Register a worker manifest
 * engine.registerWorker(manifest);
 *
 * // Transition a worker to active
 * const status = await engine.transition(workerId, "active", "Starting work cycle");
 *
 * // Complete a work cycle
 * const cooled = await engine.completeCycle(workerId, "completed");
 *
 * // Listen for transitions
 * engine.onTransition((t) => console.log(`${t.workerId}: ${t.fromState} -> ${t.toState}`));
 * ```
 */
export class WorkerLifecycleEngine {
	private config: LifecycleConfig;
	private workers: Map<string, WorkerStatus>;
	private manifests: Map<string, WorkerManifest>;
	private transitionCallbacks: Array<(transition: WorkerTransition) => void>;
	private dedupHistory: Map<string, DedupHistoryEntry[]>;

	/**
	 * Create a new WorkerLifecycleEngine.
	 *
	 * @param config - Optional partial configuration. Missing keys use defaults.
	 */
	constructor(config?: Partial<LifecycleConfig>) {
		this.config = {
			autoActivateOnRegister: config?.autoActivateOnRegister ?? DEFAULT_LIFECYCLE_CONFIG.autoActivateOnRegister,
			enforceBudgets: config?.enforceBudgets ?? DEFAULT_LIFECYCLE_CONFIG.enforceBudgets,
			enforceCooldowns: config?.enforceCooldowns ?? DEFAULT_LIFECYCLE_CONFIG.enforceCooldowns,
			enableDeduplication: config?.enableDeduplication ?? DEFAULT_LIFECYCLE_CONFIG.enableDeduplication,
			defaultDedupConfig: config?.defaultDedupConfig ?? { ...DEFAULT_LIFECYCLE_CONFIG.defaultDedupConfig },
		};
		this.workers = new Map();
		this.manifests = new Map();
		this.transitionCallbacks = [];
		this.dedupHistory = new Map();
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the engine configuration.
	 *
	 * Only provided fields are changed; missing fields keep their current values.
	 */
	setConfig(config: Partial<LifecycleConfig>): void {
		if (config.autoActivateOnRegister !== undefined) {
			this.config.autoActivateOnRegister = config.autoActivateOnRegister;
		}
		if (config.enforceBudgets !== undefined) {
			this.config.enforceBudgets = config.enforceBudgets;
		}
		if (config.enforceCooldowns !== undefined) {
			this.config.enforceCooldowns = config.enforceCooldowns;
		}
		if (config.enableDeduplication !== undefined) {
			this.config.enableDeduplication = config.enableDeduplication;
		}
		if (config.defaultDedupConfig !== undefined) {
			this.config.defaultDedupConfig = { ...config.defaultDedupConfig };
		}
	}

	/**
	 * Get a snapshot of the current engine configuration.
	 */
	getConfig(): LifecycleConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Worker Registration
	// -----------------------------------------------------------------------

	/**
	 * Register a worker with the lifecycle engine.
	 *
	 * Creates an initial WorkerStatus from the manifest and optionally
	 * transitions the worker from dormant to standby if autoActivateOnRegister
	 * is enabled.
	 *
	 * @param manifest - The worker's manifest.
	 * @returns The initial WorkerStatus.
	 * @throws If a worker with the same ID is already registered.
	 */
	registerWorker(manifest: WorkerManifest): WorkerStatus {
		if (this.workers.has(manifest.id)) {
			throw new Error(`Worker '${manifest.id}' is already registered`);
		}

		const status: WorkerStatus = {
			workerId: manifest.id,
			state: "dormant",
			role: manifest.role,
			timestamp: new Date().toISOString(),
			budgetConsumption: {
				currentCycleTokens: 0,
				totalTokens: 0,
				currentCycleRuntimeMs: 0,
				consecutiveFailures: 0,
			},
			cooldown: createWorkerCooldown(),
			recentDiagnostics: [],
			totalCyclesCompleted: 0,
			totalCyclesFailed: 0,
			lastCycleStartedAt: null,
			lastCycleCompletedAt: null,
			totalDeduped: 0,
			healthy: true,
			healthDetail: "Worker registered",
			metadata: {},
		};

		this.workers.set(manifest.id, status);
		this.manifests.set(manifest.id, manifest);

		if (this.config.autoActivateOnRegister) {
			// Transition to standby directly (bypassing the transition validation
			// by using the internal method)
			const oldState = status.state;
			status.state = "standby";
			status.timestamp = new Date().toISOString();

			const transition: WorkerTransition = {
				workerId: manifest.id,
				fromState: oldState,
				toState: "standby",
				reason: "Auto-activated on registration",
				triggeredBy: "system",
				timestamp: status.timestamp,
			};

			this.emitTransition(transition);
		}

		return status;
	}

	/**
	 * Unregister a worker from the lifecycle engine.
	 *
	 * @param workerId - The ID of the worker to unregister.
	 * @returns true if the worker was found and removed.
	 */
	unregisterWorker(workerId: string): boolean {
		const removed = this.workers.delete(workerId);
		this.manifests.delete(workerId);
		return removed;
	}

	/**
	 * Get the current status of a worker.
	 *
	 * @param workerId - The worker's ID.
	 * @returns The worker's status, or undefined if not registered.
	 */
	getStatus(workerId: string): WorkerStatus | undefined {
		return this.workers.get(workerId);
	}

	/**
	 * Get the manifest for a registered worker.
	 *
	 * @param workerId - The worker's ID.
	 * @returns The worker's manifest, or undefined if not registered.
	 */
	getManifest(workerId: string): WorkerManifest | undefined {
		return this.manifests.get(workerId);
	}

	/**
	 * Get all registered worker statuses.
	 */
	getAllStatuses(): WorkerStatus[] {
		return Array.from(this.workers.values());
	}

	/**
	 * Get the count of registered workers.
	 */
	get workerCount(): number {
		return this.workers.size;
	}

	// -----------------------------------------------------------------------
	// Event Subscription
	// -----------------------------------------------------------------------

	/**
	 * Register a callback for lifecycle transition events.
	 *
	 * The callback is invoked synchronously after each transition is
	 * recorded. Multiple callbacks can be registered; they are called
	 * in registration order.
	 */
	onTransition(callback: (transition: WorkerTransition) => void): void {
		this.transitionCallbacks.push(callback);
	}

	// -----------------------------------------------------------------------
	// State Transitions
	// -----------------------------------------------------------------------

	/**
	 * Transition a worker to a new lifecycle state.
	 *
	 * Validates the transition against ALLOWED_TRANSITIONS, enforces
	 * policy rules, and records the transition. Returns the updated
	 * WorkerStatus.
	 *
	 * @param workerId - The ID of the worker to transition.
	 * @param toState - The target lifecycle state.
	 * @param reason - Human-readable reason for the transition.
	 * @param triggeredBy - Who or what triggered the transition.
	 * @param diagnostic - Optional diagnostic to attach.
	 * @returns The updated WorkerStatus.
	 * @throws If the worker is not registered or the transition is invalid.
	 */
	transition(
		workerId: string,
		toState: WorkerLifecycleState,
		reason: string,
		triggeredBy: "system" | "user" | "policy" | "budget" | "stop_condition" = "system",
		diagnostic?: WorkerDiagnostic,
	): WorkerStatus {
		const status = this.getStatusOrThrow(workerId);
		const fromState = status.state;

		// Check if the transition is allowed
		if (!ALLOWED_TRANSITIONS[toState].has(fromState)) {
			throw new Error(
				`Cannot transition worker '${workerId}' from '${fromState}' to '${toState}': transition not allowed`,
			);
		}

		// Enforce cooldown: cannot go directly from cooling to active
		if (toState === "active" && fromState === "cooling") {
			// Must go through standby first
			throw new Error(
				`Cannot transition worker '${workerId}' from '${fromState}' to '${toState}': worker must go through standby after cooldown`,
			);
		}

		// Update the state
		status.state = toState;
		status.timestamp = new Date().toISOString();

		// Update health based on state
		if (toState === "failed") {
			status.healthy = false;
			status.healthDetail = reason;
		} else if (toState === "retired") {
			status.healthy = false;
			status.healthDetail = "Worker has been retired";
		} else if (OPERATIONAL_STATES.includes(toState) && !status.healthy) {
			// If transitioning back to an operational state, mark as healthy
			status.healthy = true;
			status.healthDetail = "Worker is operational";
		}

		// Track cycle start/stop
		if (toState === "active") {
			status.lastCycleStartedAt = status.timestamp;
			status.budgetConsumption.currentCycleTokens = 0;
			status.budgetConsumption.currentCycleRuntimeMs = 0;
		}

		// Add diagnostic if provided
		if (diagnostic) {
			status.recentDiagnostics.unshift(diagnostic);
			if (status.recentDiagnostics.length > MAX_DIAGNOSTICS) {
				status.recentDiagnostics = status.recentDiagnostics.slice(0, MAX_DIAGNOSTICS);
			}
		}

		// Emit the transition event
		const transition: WorkerTransition = {
			workerId,
			fromState,
			toState,
			reason,
			triggeredBy,
			timestamp: status.timestamp,
			diagnostic,
		};

		this.emitTransition(transition);

		return status;
	}

	// -----------------------------------------------------------------------
	// Work Cycle Management
	// -----------------------------------------------------------------------

	/**
	 * Start a worker's work cycle — transitions from standby to active.
	 *
	 * Validates that the worker is in standby state and that budget and
	 * cooldown constraints are satisfied.
	 *
	 * @param workerId - The ID of the worker to start.
	 * @returns The updated WorkerStatus.
	 * @throws If the worker is not in standby or constraints are violated.
	 */
	startCycle(workerId: string): WorkerStatus {
		const status = this.getStatusOrThrow(workerId);

		if (status.state !== "standby") {
			throw new Error(
				`Cannot start cycle for worker '${workerId}': current state is '${status.state}', expected 'standby'`,
			);
		}

		// Check cooldown
		if (this.config.enforceCooldowns && this.isInCooldown(status)) {
			throw new Error(
				`Cannot start cycle for worker '${workerId}': worker is in cooldown until ${status.cooldown.endsAt}`,
			);
		}

		return this.transition(workerId, "active", "Work cycle started", "system");
	}

	/**
	 * Complete a worker's work cycle — transitions from active to cooling.
	 *
	 * Records the cycle result, updates budget consumption, and manages
	 * consecutive failure tracking and dedup history.
	 *
	 * @param workerId - The ID of the worker to complete.
	 * @param stopCondition - The condition that ended the cycle.
	 * @param context - Optional context about the completed cycle.
	 * @returns The updated WorkerStatus.
	 * @throws If the worker is not in active state.
	 */
	completeCycle(
		workerId: string,
		stopCondition: WorkerStopCondition,
		context: Record<string, unknown> = {},
	): WorkerStatus {
		const status = this.getStatusOrThrow(workerId);

		if (status.state !== "active") {
			throw new Error(
				`Cannot complete cycle for worker '${workerId}': current state is '${status.state}', expected 'active'`,
			);
		}

		const isFailure = stopCondition !== "completed";

		// Update cycle counters
		if (isFailure) {
			status.totalCyclesFailed++;
			status.budgetConsumption.consecutiveFailures++;
		} else {
			status.totalCyclesCompleted++;
			status.budgetConsumption.consecutiveFailures = 0;
		}

		// Track runtime
		if (status.lastCycleStartedAt) {
			const startedAt = new Date(status.lastCycleStartedAt).getTime();
			status.budgetConsumption.currentCycleRuntimeMs = Date.now() - startedAt;
		}

		status.lastCycleCompletedAt = new Date().toISOString();

		// Check for consecutive failure threshold
		const manifest = this.getManifestOrThrow(workerId);
		const budget = manifest.budget;

		if (
			isFailure &&
			this.config.enforceBudgets &&
			status.budgetConsumption.consecutiveFailures >= budget.maxConsecutiveFailures
		) {
			// Transition to failed state
			const diagnostic = createWorkerDiagnostic(
				"consecutive_failures_exceeded",
				`Worker exceeded max consecutive failures (${budget.maxConsecutiveFailures})`,
				{
					consecutiveFailures: status.budgetConsumption.consecutiveFailures,
					maxConsecutiveFailures: budget.maxConsecutiveFailures,
					stopCondition,
				},
				[],
			);

			return this.transition(workerId, "failed", diagnostic.message, "budget", diagnostic);
		}

		// Set cooldown
		if (this.config.enforceCooldowns && budget.cooldownMs > 0) {
			const now = Date.now();
			status.cooldown = {
				startedAt: new Date(now).toISOString(),
				endsAt: new Date(now + budget.cooldownMs).toISOString(),
				reason: `Cycle completed with condition: ${stopCondition}`,
				count: status.cooldown.count + 1,
			};
		}

		// Create diagnostic for stop condition
		const diagnostic = createWorkerDiagnostic(
			stopCondition,
			`Work cycle completed with condition: ${stopCondition}`,
			{
				cycleRuntimeMs: status.budgetConsumption.currentCycleRuntimeMs,
				totalTokens: status.budgetConsumption.totalTokens,
				totalCyclesCompleted: status.totalCyclesCompleted,
				totalCyclesFailed: status.totalCyclesFailed,
				...context,
			},
		);

		return this.transition(workerId, "cooling", diagnostic.message, "stop_condition", diagnostic);
	}

	/**
	 * Complete the cooldown period — transitions from cooling to standby.
	 *
	 * @param workerId - The ID of the worker.
	 * @returns The updated WorkerStatus.
	 * @throws If the worker is not in cooling state.
	 */
	finishCooldown(workerId: string): WorkerStatus {
		const status = this.getStatusOrThrow(workerId);

		if (status.state !== "cooling") {
			throw new Error(
				`Cannot finish cooldown for worker '${workerId}': current state is '${status.state}', expected 'cooling'`,
			);
		}

		status.cooldown = createWorkerCooldown();

		return this.transition(workerId, "standby", "Cooldown period completed", "system");
	}

	/**
	 * Handle a timeout — force-stop a worker that exceeded its runtime budget.
	 *
	 * @param workerId - The ID of the worker.
	 * @returns The updated WorkerStatus.
	 */
	handleTimeout(workerId: string): WorkerStatus {
		const status = this.getStatusOrThrow(workerId);

		const diagnostic = createWorkerDiagnostic("timeout", "Worker cycle exceeded maxRuntimeMs budget", {
			currentCycleRuntimeMs: status.budgetConsumption.currentCycleRuntimeMs,
			maxRuntimeMs: this.getManifestOrThrow(workerId).budget.maxRuntimeMs,
		});

		status.totalCyclesFailed++;
		status.budgetConsumption.consecutiveFailures++;

		// Set cooldown even on timeout
		const budget = this.getManifestOrThrow(workerId).budget;
		if (budget.cooldownMs > 0) {
			const now = Date.now();
			status.cooldown = {
				startedAt: new Date(now).toISOString(),
				endsAt: new Date(now + budget.cooldownMs).toISOString(),
				reason: "Timeout — exceeded runtime budget",
				count: status.cooldown.count + 1,
			};
		}

		return this.transition(workerId, "cooling", diagnostic.message, "budget", diagnostic);
	}

	/**
	 * Handle a token budget exhaustion — force-stop a worker.
	 *
	 * @param workerId - The ID of the worker.
	 * @returns The updated WorkerStatus.
	 */
	handleTokenBudgetExhaustion(workerId: string): WorkerStatus {
		const status = this.getStatusOrThrow(workerId);

		const diagnostic = createWorkerDiagnostic("token_budget_exhausted", "Worker exceeded maxTokensPerCycle budget", {
			currentCycleTokens: status.budgetConsumption.currentCycleTokens,
			maxTokensPerCycle: this.getManifestOrThrow(workerId).budget.maxTokensPerCycle,
		});

		status.totalCyclesFailed++;
		status.budgetConsumption.consecutiveFailures++;

		return this.transition(workerId, "cooling", diagnostic.message, "budget", diagnostic);
	}

	// -----------------------------------------------------------------------
	// Budget Tracking
	// -----------------------------------------------------------------------

	/**
	 * Record token consumption for a worker's current cycle.
	 *
	 * If enforceBudgets is enabled and the worker exceeds its
	 * maxTokensPerCycle, the worker is force-stopped via
	 * handleTokenBudgetExhaustion.
	 *
	 * @param workerId - The ID of the worker.
	 * @param tokens - The number of tokens consumed.
	 * @returns The updated WorkerStatus, or null if the worker is not active.
	 */
	recordTokens(workerId: string, tokens: number): WorkerStatus | null {
		const status = this.workers.get(workerId);
		if (!status) return null;

		status.budgetConsumption.currentCycleTokens += tokens;
		status.budgetConsumption.totalTokens += tokens;

		if (
			this.config.enforceBudgets &&
			status.state === "active" &&
			status.budgetConsumption.currentCycleTokens > this.getManifestOrThrow(workerId).budget.maxTokensPerCycle
		) {
			return this.handleTokenBudgetExhaustion(workerId);
		}

		status.timestamp = new Date().toISOString();
		return status;
	}

	/**
	 * Check if a worker has exceeded its runtime budget.
	 *
	 * @param workerId - The ID of the worker.
	 * @returns true if the worker has exceeded maxRuntimeMs.
	 */
	isOverRuntimeBudget(workerId: string): boolean {
		const status = this.workers.get(workerId);
		if (!status || !status.lastCycleStartedAt) return false;

		const budget = this.getManifestOrThrow(workerId).budget;
		const elapsed = Date.now() - new Date(status.lastCycleStartedAt).getTime();

		return elapsed > budget.maxRuntimeMs;
	}

	// -----------------------------------------------------------------------
	// Cooldown Management
	// -----------------------------------------------------------------------

	/**
	 * Check if a worker is currently in cooldown.
	 *
	 * @param status - The worker's status.
	 * @returns true if the worker's cooldown period is still active.
	 */
	private isInCooldown(status: WorkerStatus): boolean {
		if (!status.cooldown.endsAt) return false;
		return Date.now() < new Date(status.cooldown.endsAt).getTime();
	}

	/**
	 * Check if a worker's cooldown period has elapsed and transition
	 * it from cooling to standby if appropriate.
	 *
	 * @param workerId - The ID of the worker to check.
	 * @returns The updated WorkerStatus if transitioned, or undefined.
	 */
	checkCooldown(workerId: string): WorkerStatus | undefined {
		const status = this.workers.get(workerId);
		if (!status || status.state !== "cooling") return undefined;

		if (!this.isInCooldown(status)) {
			return this.finishCooldown(workerId);
		}

		return undefined;
	}

	/**
	 * Check all workers for completed cooldown periods and transition
	 * them back to standby.
	 *
	 * @returns Array of WorkerStatuses that were transitioned.
	 */
	checkAllCooldowns(): WorkerStatus[] {
		const transitioned: WorkerStatus[] = [];

		for (const workerId of this.workers.keys()) {
			const result = this.checkCooldown(workerId);
			if (result) {
				transitioned.push(result);
			}
		}

		return transitioned;
	}

	// -----------------------------------------------------------------------
	// Deduplication
	// -----------------------------------------------------------------------

	/**
	 * Compute a content hash for a task string.
	 *
	 * @param content - The task content to hash.
	 * @returns A SHA-256 hex digest of the content.
	 */
	private computeTaskHash(content: string): string {
		return createHash("sha256").update(content).digest("hex");
	}

	/**
	 * Check if a task should be deduplicated (suppressed) based on history.
	 *
	 * Uses configured dedup strategy:
	 * 1. Exact match on content hash within windowMs
	 * 2. Similarity match if useSimilarity is enabled
	 *
	 * @param workerId - The ID of the worker.
	 * @param taskContent - The task content to check.
	 * @returns A dedup result with suppression info, or null if not a duplicate.
	 */
	checkDedup(
		workerId: string,
		taskContent: string,
	): {
		isDuplicate: boolean;
		matchType: "exact_match" | "similarity_match" | "no_match";
		matchingEntry?: DedupHistoryEntry;
	} {
		if (!this.config.enableDeduplication) {
			return { isDuplicate: false, matchType: "no_match" };
		}

		const manifest = this.manifests.get(workerId);
		const dedupConfig = manifest?.dedupConfig ?? this.config.defaultDedupConfig;

		if (!dedupConfig.enabled) {
			return { isDuplicate: false, matchType: "no_match" };
		}

		const taskHash = this.computeTaskHash(taskContent);
		const now = Date.now();
		const windowMs = dedupConfig.windowMs;

		// Get recent history for this worker
		const history = this.dedupHistory.get(workerId) ?? [];

		// Check exact match
		const exactMatch = history.find((entry) => {
			const age = now - new Date(entry.originalTimestamp).getTime();
			return entry.taskHash === taskHash && age <= windowMs;
		});

		if (exactMatch) {
			return { isDuplicate: true, matchType: "exact_match", matchingEntry: exactMatch };
		}

		// Check similarity match
		if (dedupConfig.useSimilarity) {
			const _similarityMatch = history.find((entry) => {
				const age = now - new Date(entry.originalTimestamp).getTime();
				if (age > windowMs) return false;
				// We don't have the original content, so similarity is based on
				// hash proximity. In a real implementation, we would store the
				// original content alongside the hash.
				return false;
			});

			// For simplicity, we won't do full content similarity here since
			// we only store hashes. The interface is prepared for it.
		}

		return { isDuplicate: false, matchType: "no_match" };
	}

	/**
	 * Record a task in the dedup history.
	 *
	 * @param workerId - The ID of the worker.
	 * @param taskContent - The task content to record.
	 */
	recordTask(workerId: string, taskContent: string): void {
		const taskHash = this.computeTaskHash(taskContent);
		const now = new Date().toISOString();

		const entry: DedupHistoryEntry = {
			taskHash,
			originalTimestamp: now,
			suppressedAt: now,
			reason: "exact_match",
		};

		const history = this.dedupHistory.get(workerId) ?? [];
		history.unshift(entry);

		// Trim history
		if (history.length > MAX_DEDUP_HISTORY) {
			history.length = MAX_DEDUP_HISTORY;
		}

		this.dedupHistory.set(workerId, history);
	}

	/**
	 * Record a deduplicated (suppressed) task in history.
	 *
	 * @param workerId - The ID of the worker.
	 * @param taskContent - The task content that was deduped.
	 * @param matchType - The type of match that triggered dedup.
	 */
	recordDedupedTask(workerId: string, taskContent: string, matchType: "exact_match" | "similarity_match"): void {
		const taskHash = this.computeTaskHash(taskContent);
		const now = new Date().toISOString();

		const entry: DedupHistoryEntry = {
			taskHash,
			originalTimestamp: now,
			suppressedAt: now,
			reason: matchType,
		};

		const history = this.dedupHistory.get(workerId) ?? [];
		history.unshift(entry);

		if (history.length > MAX_DEDUP_HISTORY) {
			history.length = MAX_DEDUP_HISTORY;
		}

		this.dedupHistory.set(workerId, history);

		// Update the dedup counter
		const status = this.workers.get(workerId);
		if (status) {
			status.totalDeduped++;
			status.timestamp = now;
		}
	}

	/**
	 * Get the dedup history for a worker.
	 *
	 * @param workerId - The worker's ID.
	 * @returns Array of dedup history entries, or empty array.
	 */
	getDedupHistory(workerId: string): DedupHistoryEntry[] {
		return this.dedupHistory.get(workerId) ?? [];
	}

	// -----------------------------------------------------------------------
	// Health & Diagnostics
	// -----------------------------------------------------------------------

	/**
	 * Get a health summary for all registered workers.
	 *
	 * @returns An object with healthy count, failed count, etc.
	 */
	getHealthSummary(): { total: number; healthy: number; failed: number; retired: number; cooling: number } {
		const all = this.getAllStatuses();
		return {
			total: all.length,
			healthy: all.filter((s) => s.healthy).length,
			failed: all.filter((s) => s.state === "failed").length,
			retired: all.filter((s) => s.state === "retired").length,
			cooling: all.filter((s) => s.state === "cooling").length,
		};
	}

	/**
	 * Force-health-check a worker and transition to failed if unhealthy.
	 *
	 * Checks:
	 * 1. Runtime budget exceeded
	 * 2. Consecutive failures exceeded
	 * 3. Stuck in a non-operational state for too long
	 *
	 * @param workerId - The ID of the worker to check.
	 * @returns The updated WorkerStatus if changed, or undefined.
	 */
	healthCheck(workerId: string): WorkerStatus | undefined {
		const status = this.workers.get(workerId);
		if (!status) return undefined;

		const manifest = this.manifests.get(workerId);
		if (!manifest) return undefined;

		const budget = manifest.budget;

		// Check runtime budget for active workers
		if (status.state === "active" && status.lastCycleStartedAt) {
			const elapsed = Date.now() - new Date(status.lastCycleStartedAt).getTime();
			if (elapsed > budget.maxRuntimeMs) {
				return this.handleTimeout(workerId);
			}
		}

		// Check consecutive failures
		if (status.budgetConsumption.consecutiveFailures >= budget.maxConsecutiveFailures && status.state !== "failed") {
			const diagnostic = createWorkerDiagnostic(
				"consecutive_failures_exceeded",
				`Health check: worker exceeded max consecutive failures (${budget.maxConsecutiveFailures})`,
				{
					consecutiveFailures: status.budgetConsumption.consecutiveFailures,
					maxConsecutiveFailures: budget.maxConsecutiveFailures,
				},
			);

			return this.transition(workerId, "failed", diagnostic.message, "policy", diagnostic);
		}

		// Check for stuck in cooling (cooldown expired but still in cooling)
		if (status.state === "cooling") {
			return this.checkCooldown(workerId);
		}

		return undefined;
	}

	// -----------------------------------------------------------------------
	// Private Helpers
	// -----------------------------------------------------------------------

	/**
	 * Get a worker's status or throw if not found.
	 */
	private getStatusOrThrow(workerId: string): WorkerStatus {
		const status = this.workers.get(workerId);
		if (!status) {
			throw new Error(`Worker not found: ${workerId}`);
		}
		return status;
	}

	/**
	 * Get a worker's manifest or throw if not found.
	 */
	private getManifestOrThrow(workerId: string): WorkerManifest {
		const manifest = this.manifests.get(workerId);
		if (!manifest) {
			throw new Error(`Worker manifest not found: ${workerId}`);
		}
		return manifest;
	}

	/**
	 * Emit a transition event to all registered callbacks.
	 */
	private emitTransition(transition: WorkerTransition): void {
		for (const callback of this.transitionCallbacks) {
			try {
				callback(transition);
			} catch {
				// Swallow callback errors to prevent one bad callback from
				// breaking the entire transition flow
			}
		}
	}
}

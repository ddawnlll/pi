/**
 * Observation Engine V0 — P13.C
 *
 * Collects structured observations from:
 * - Queue health observer: monitors plan queue vs integration queue state
 * - Execution journal observer: watches `.pi/execution-journal.ndjson` for workspace outcomes
 * - Retry/failure signal extractor: parses workspace outcomes for patterns
 *
 * Each observer produces BrainObservation and optionally BrainSignal objects.
 * Observations are recorded to the BrainTimelineStore.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrainTimelineStore } from "./timeline-store.js";
import type { BrainObservation, BrainSignal, BrainTimelineEvent, SourceRef } from "./types.js";
import { createBrainObservation, createBrainSignal, createBrainTimelineEvent } from "./types.js";

// ── Types ──────────────────────────────────────────────────────────────

/** Configuration for the Observation Engine. */
export interface ObservationEngineConfig {
	/** Workspace root directory. */
	workspaceRoot: string;
	/** .pi directory name (default: ".pi"). */
	piDir?: string;
	/** Brain timeline store instance. */
	timelineStore: BrainTimelineStore;
}

/** Result of running an observation cycle. */
export interface ObservationResult {
	observations: BrainObservation[];
	signals: BrainSignal[];
	timelineEvents: BrainTimelineEvent[];
	errors: string[];
}

/**
 * Observer interface.
 * Each observer examines a specific data source and produces observations.
 */
export interface Observer {
	/** Human-readable name of this observer. */
	readonly name: string;
	/**
	 * Run a single observation cycle.
	 * Returns observations, signals, timeline events, and any errors.
	 */
	observe(): Promise<ObserverOutput>;
}

/** Output from a single observer run. */
export interface ObserverOutput {
	observations: BrainObservation[];
	signals: BrainSignal[];
	timelineEvents: BrainTimelineEvent[];
	errors: string[];
}

// ── Observer: Queue Health ─────────────────────────────────────────────

/** State of the plan queue as read from disk. */
interface PlanQueueState {
	entries: Array<{
		id: string;
		status: string;
		blockReason?: string;
		waitingReason?: string;
		error?: string;
	}>;
	isRunning: boolean;
	activeEntryId?: string;
	stopOnFailure?: boolean;
}

/** State of the integration queue as read from disk. */
interface IntegrationQueueState {
	entries: Array<{
		workspaceId: string;
		status: string;
		error?: string;
	}>;
	isProcessing: boolean;
	paused: boolean;
	currentWorkspaceId?: string;
}

/**
 * Queue Health Observer
 *
 * Monitors the plan queue (.pi/plan-queue.json) and the integration queue
 * (.pi/integration-queue.json) for:
 * - Integration queue being dirty (non-merged entries)
 * - Plan queue blocked status
 * - Integration queue paused state
 */
export class QueueHealthObserver implements Observer {
	readonly name = "QueueHealthObserver";
	private workspaceRoot: string;
	private piDir: string;

	constructor(config: { workspaceRoot: string; piDir?: string }) {
		this.workspaceRoot = config.workspaceRoot;
		this.piDir = config.piDir ?? ".pi";
	}

	async observe(): Promise<ObserverOutput> {
		const observations: BrainObservation[] = [];
		const signals: BrainSignal[] = [];
		const timelineEvents: BrainTimelineEvent[] = [];
		const errors: string[] = [];

		try {
			// Check integration queue state
			const integrationObs = await this.checkIntegrationQueue();
			observations.push(...integrationObs.observations);
			signals.push(...integrationObs.signals);
			timelineEvents.push(...integrationObs.timelineEvents);
			errors.push(...integrationObs.errors);
		} catch (error) {
			errors.push(`Integration queue check failed: ${error instanceof Error ? error.message : String(error)}`);
		}

		try {
			// Check plan queue state
			const planObs = await this.checkPlanQueue();
			observations.push(...planObs.observations);
			signals.push(...planObs.signals);
			timelineEvents.push(...planObs.timelineEvents);
			errors.push(...planObs.errors);
		} catch (error) {
			errors.push(`Plan queue check failed: ${error instanceof Error ? error.message : String(error)}`);
		}

		return { observations, signals, timelineEvents, errors };
	}

	/**
	 * Read and analyze the integration queue state.
	 */
	private async checkIntegrationQueue(): Promise<ObserverOutput> {
		const observations: BrainObservation[] = [];
		const signals: BrainSignal[] = [];
		const timelineEvents: BrainTimelineEvent[] = [];
		const errors: string[] = [];

		const integrationQueuePath = join(this.workspaceRoot, this.piDir, "integration-queue.json");

		if (!existsSync(integrationQueuePath)) {
			return { observations, signals, timelineEvents, errors };
		}

		try {
			const content = await readFile(integrationQueuePath, "utf-8");
			const state: IntegrationQueueState = JSON.parse(content);

			// Check for dirty entries (not merged)
			const dirtyEntries = state.entries.filter((e) => e.status !== "merged" && e.status !== "queued");

			if (dirtyEntries.length > 0) {
				const evidence: SourceRef[] = [
					{
						type: "queue",
						path: `.pi/integration-queue.json`,
						timestamp: new Date().toISOString(),
					},
				];

				const obs = createBrainObservation({
					source: "integration",
					signalType: "integration_dirty",
					severity: dirtyEntries.some(
						(e) => e.status === "failed" || e.status === "blocked" || e.status === "conflict",
					)
						? "warning"
						: "info",
					title: `Integration queue has ${dirtyEntries.length} unresolved entr${dirtyEntries.length === 1 ? "y" : "ies"}`,
					description: `Integration queue has ${dirtyEntries.length} unresolved entries: ${dirtyEntries.map((e) => `${e.workspaceId} (${e.status})`).join(", ")}`,
					evidence,
					provenance: {
						observationSources: evidence,
						derivationChain: [],
						confidence: 0.95,
						validatedBy: "system",
					},
					metadata: {
						dirtyCount: dirtyEntries.length,
						entries: dirtyEntries.map((e) => ({ workspaceId: e.workspaceId, status: e.status })),
					},
				});

				observations.push(obs);

				timelineEvents.push(
					createBrainTimelineEvent({
						eventType: "observation",
						severity: obs.severity,
						data: {
							observationId: obs.id,
							title: obs.title,
							source: "integration",
						},
					}),
				);
			}

			// Check if integration queue is paused
			if (state.paused) {
				const evidence: SourceRef[] = [
					{
						type: "queue",
						path: `.pi/integration-queue.json`,
						timestamp: new Date().toISOString(),
					},
				];

				const obs = createBrainObservation({
					source: "integration",
					signalType: "queue_blocked",
					severity: "warning",
					title: "Integration queue is paused",
					description: "The integration queue is paused and will not process new workspace merges.",
					evidence,
					provenance: {
						observationSources: evidence,
						derivationChain: [],
						confidence: 0.95,
						validatedBy: "system",
					},
					metadata: {
						paused: true,
						entryCount: state.entries.length,
					},
				});

				observations.push(obs);

				timelineEvents.push(
					createBrainTimelineEvent({
						eventType: "observation",
						severity: "warning",
						data: {
							observationId: obs.id,
							title: obs.title,
							source: "integration",
						},
					}),
				);
			}
		} catch (error) {
			errors.push(
				`Failed to read integration queue state: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		return { observations, signals, timelineEvents, errors };
	}

	/**
	 * Read and analyze the plan queue state.
	 */
	private async checkPlanQueue(): Promise<ObserverOutput> {
		const observations: BrainObservation[] = [];
		const signals: BrainSignal[] = [];
		const timelineEvents: BrainTimelineEvent[] = [];
		const errors: string[] = [];

		const planQueuePath = join(this.workspaceRoot, this.piDir, "plan-queue.json");

		if (!existsSync(planQueuePath)) {
			return { observations, signals, timelineEvents, errors };
		}

		try {
			const content = await readFile(planQueuePath, "utf-8");
			const state: PlanQueueState = JSON.parse(content);

			// Check for blocked entries
			const blockedEntries = state.entries.filter((e) => e.status === "blocked");

			if (blockedEntries.length > 0) {
				const evidence: SourceRef[] = [
					{
						type: "queue",
						path: `.pi/plan-queue.json`,
						timestamp: new Date().toISOString(),
					},
				];

				const blockedReasons = blockedEntries
					.map((e) => e.blockReason || e.waitingReason || "unknown")
					.filter(Boolean);

				const obs = createBrainObservation({
					source: "queue",
					signalType: "queue_blocked",
					severity: "warning",
					title: `Plan queue has ${blockedEntries.length} blocked entr${blockedEntries.length === 1 ? "y" : "ies"}`,
					description: `Plan queue has ${blockedEntries.length} blocked entries. Reasons: ${blockedReasons.join("; ")}`,
					evidence,
					provenance: {
						observationSources: evidence,
						derivationChain: [],
						confidence: 0.9,
						validatedBy: "system",
					},
					metadata: {
						blockedCount: blockedEntries.length,
						blockedEntries: blockedEntries.map((e) => ({
							id: e.id,
							reason: e.blockReason || e.waitingReason || "unknown",
						})),
						totalEntries: state.entries.length,
						isRunning: state.isRunning,
					},
				});

				observations.push(obs);

				timelineEvents.push(
					createBrainTimelineEvent({
						eventType: "observation",
						severity: "warning",
						data: {
							observationId: obs.id,
							title: obs.title,
							source: "queue",
						},
					}),
				);
			}

			// Check for failed entries
			const failedEntries = state.entries.filter((e) => e.status === "failed");

			if (failedEntries.length > 0) {
				const evidence: SourceRef[] = [
					{
						type: "queue",
						path: `.pi/plan-queue.json`,
						timestamp: new Date().toISOString(),
					},
				];

				const obs = createBrainObservation({
					source: "queue",
					signalType: "failure_pattern",
					severity: "critical",
					title: `Plan queue has ${failedEntries.length} failed entr${failedEntries.length === 1 ? "y" : "ies"}`,
					description: `Plan queue has ${failedEntries.length} failed entries: ${failedEntries.map((e) => e.error || "unknown error").join("; ")}`,
					evidence,
					provenance: {
						observationSources: evidence,
						derivationChain: [],
						confidence: 0.95,
						validatedBy: "system",
					},
					metadata: {
						failedCount: failedEntries.length,
						failedEntries: failedEntries.map((e) => ({
							id: e.id,
							error: e.error || "unknown",
						})),
					},
				});

				observations.push(obs);

				timelineEvents.push(
					createBrainTimelineEvent({
						eventType: "observation",
						severity: "critical",
						data: {
							observationId: obs.id,
							title: obs.title,
							source: "queue",
						},
					}),
				);
			}
		} catch (error) {
			errors.push(`Failed to read plan queue state: ${error instanceof Error ? error.message : String(error)}`);
		}

		return { observations, signals, timelineEvents, errors };
	}
}

// ── Observer: Execution Journal ────────────────────────────────────────

/** A single line entry in the execution journal NDJSON file. */
interface JournalEntry {
	type: string;
	timestamp: string;
	workspaceId?: string;
	planExecId?: string;
	role?: string;
	attempt?: number;
	verdict?: string;
	error?: string;
	duration?: number;
	[key: string]: unknown;
}

/**
 * Execution Journal Observer
 *
 * Reads `.pi/execution-journal.ndjson` and produces observations about:
 * - Workspace completions and failures
 * - Retry events
 * - Execution duration anomalies
 */
export class ExecutionJournalObserver implements Observer {
	readonly name = "ExecutionJournalObserver";
	private workspaceRoot: string;
	private piDir: string;
	/** Track the last observed position (line count) to avoid re-processing. */
	private lastObservedPosition: number = 0;

	constructor(config: { workspaceRoot: string; piDir?: string }) {
		this.workspaceRoot = config.workspaceRoot;
		this.piDir = config.piDir ?? ".pi";
	}

	async observe(): Promise<ObserverOutput> {
		const observations: BrainObservation[] = [];
		const signals: BrainSignal[] = [];
		const timelineEvents: BrainTimelineEvent[] = [];
		const errors: string[] = [];

		const journalPath = join(this.workspaceRoot, this.piDir, "execution-journal.ndjson");

		if (!existsSync(journalPath)) {
			return { observations, signals, timelineEvents, errors };
		}

		try {
			const content = await readFile(journalPath, "utf-8");
			const lines = content.split("\n").filter((l) => l.trim().length > 0);

			// Only process new entries since last observation
			if (lines.length <= this.lastObservedPosition) {
				return { observations, signals, timelineEvents, errors };
			}

			const newEntries: JournalEntry[] = [];

			for (let i = this.lastObservedPosition; i < lines.length; i++) {
				try {
					const entry = JSON.parse(lines[i]) as JournalEntry;
					newEntries.push(entry);
				} catch {
					// Skip corrupted lines
				}
			}

			// Process new journal entries
			for (const entry of newEntries) {
				const result = this.processJournalEntry(entry);
				observations.push(...result.observations);
				signals.push(...result.signals);
				timelineEvents.push(...result.timelineEvents);
				errors.push(...result.errors);
			}

			this.lastObservedPosition = lines.length;
		} catch (error) {
			errors.push(`Failed to read execution journal: ${error instanceof Error ? error.message : String(error)}`);
		}

		return { observations, signals, timelineEvents, errors };
	}

	/**
	 * Process a single journal entry and produce observations.
	 */
	private processJournalEntry(entry: JournalEntry): ObserverOutput {
		const observations: BrainObservation[] = [];
		const signals: BrainSignal[] = [];
		const timelineEvents: BrainTimelineEvent[] = [];
		const errors: string[] = [];

		const evidence: SourceRef[] = [
			{
				type: "journal",
				path: `.pi/execution-journal.ndjson`,
				timestamp: entry.timestamp,
			},
		];

		// Handle workspace completion entries
		if (entry.type === "workspace_complete" && entry.verdict === "failed") {
			const obs = createBrainObservation({
				source: "execution",
				signalType: "failure_pattern",
				severity: entry.attempt && entry.attempt > 1 ? "warning" : "critical",
				title: `Workspace failed: ${entry.workspaceId || "unknown"}`,
				description: `Workspace ${entry.workspaceId || "unknown"} failed${entry.attempt && entry.attempt > 1 ? ` after ${entry.attempt} attempts` : ""}${entry.error ? `: ${entry.error}` : ""}`,
				evidence,
				provenance: {
					observationSources: evidence,
					derivationChain: [],
					confidence: 0.95,
					validatedBy: "system",
				},
				metadata: {
					workspaceId: entry.workspaceId,
					planExecId: entry.planExecId,
					role: entry.role,
					attempt: entry.attempt,
					error: entry.error,
					duration: entry.duration,
				},
			});

			observations.push(obs);

			timelineEvents.push(
				createBrainTimelineEvent({
					eventType: "observation",
					severity: obs.severity,
					workspaceId: entry.workspaceId,
					planExecId: entry.planExecId,
					data: {
						observationId: obs.id,
						title: obs.title,
						verdict: "failed",
					},
				}),
			);
		}

		// Handle workspace completion success
		if (entry.type === "workspace_complete" && entry.verdict === "complete") {
			const obs = createBrainObservation({
				source: "execution",
				signalType: "failure_pattern",
				severity: "info",
				title: `Workspace completed: ${entry.workspaceId || "unknown"}`,
				description: `Workspace ${entry.workspaceId || "unknown"} completed successfully${entry.attempt && entry.attempt > 1 ? ` after ${entry.attempt} attempts` : ""}`,
				evidence,
				provenance: {
					observationSources: evidence,
					derivationChain: [],
					confidence: 0.95,
					validatedBy: "system",
				},
				metadata: {
					workspaceId: entry.workspaceId,
					planExecId: entry.planExecId,
					role: entry.role,
					attempt: entry.attempt,
					duration: entry.duration,
				},
			});

			observations.push(obs);

			timelineEvents.push(
				createBrainTimelineEvent({
					eventType: "observation",
					severity: "info",
					workspaceId: entry.workspaceId,
					planExecId: entry.planExecId,
					data: {
						observationId: obs.id,
						title: obs.title,
						verdict: "complete",
					},
				}),
			);
		}

		// Handle retry events
		if (entry.type === "retry" || entry.type === "workspace_retry") {
			const obs = createBrainObservation({
				source: "execution",
				signalType: "retry_hotspot",
				severity: "warning",
				title: `Workspace retry: ${entry.workspaceId || "unknown"} (attempt ${entry.attempt || "?"})`,
				description: `Workspace ${entry.workspaceId || "unknown"} is being retried${entry.attempt ? ` (attempt ${entry.attempt})` : ""}${entry.error ? ` due to: ${entry.error}` : ""}`,
				evidence,
				provenance: {
					observationSources: evidence,
					derivationChain: [],
					confidence: 0.9,
					validatedBy: "system",
				},
				metadata: {
					workspaceId: entry.workspaceId,
					planExecId: entry.planExecId,
					attempt: entry.attempt,
					error: entry.error,
				},
			});

			observations.push(obs);

			timelineEvents.push(
				createBrainTimelineEvent({
					eventType: "observation",
					severity: "warning",
					workspaceId: entry.workspaceId,
					planExecId: entry.planExecId,
					data: {
						observationId: obs.id,
						title: obs.title,
						entryType: entry.type,
					},
				}),
			);
		}

		return { observations, signals, timelineEvents, errors };
	}
}

// ── Observer: Retry/Failure Signal Extractor ───────────────────────────

/** Tracked workspace retry state. */
interface WorkspaceRetryState {
	workspaceId: string;
	retryCount: number;
	firstRetryAt: string;
	lastRetryAt: string;
	lastError: string | null;
}

/**
 * Retry/Failure Signal Extractor
 *
 * Analyzes observations from the execution journal and queue health
 * to detect patterns such as:
 * - Retry hotspots (3+ retries in a time window)
 * - Recurring failure patterns (same error across workspaces)
 * - Repeated queue blocks
 */
export class RetryFailureSignalExtractor implements Observer {
	readonly name = "RetryFailureSignalExtractor";
	private workspaceRoot: string;
	private piDir: string;
	/** In-memory tracking of workspace retry counts. */
	private retryStates: Map<string, WorkspaceRetryState> = new Map();

	constructor(config: { workspaceRoot: string; piDir?: string }) {
		this.workspaceRoot = config.workspaceRoot;
		this.piDir = config.piDir ?? ".pi";
	}

	/**
	 * Process a batch of observations and extract signals.
	 *
	 * Takes existing observations (e.g., from other observers during
	 * the same cycle) and produces higher-level signals.
	 */
	async observe(): Promise<ObserverOutput> {
		const observations: BrainObservation[] = [];
		const signals: BrainSignal[] = [];
		const timelineEvents: BrainTimelineEvent[] = [];
		const errors: string[] = [];

		// Read execution journal to track retry states
		const journalPath = join(this.workspaceRoot, this.piDir, "execution-journal.ndjson");

		if (!existsSync(journalPath)) {
			return { observations, signals, timelineEvents, errors };
		}

		try {
			const content = await readFile(journalPath, "utf-8");
			const lines = content.split("\n").filter((l) => l.trim().length > 0);

			// Scan for retry entries
			const retryEntries: JournalEntry[] = [];

			for (const line of lines) {
				try {
					const entry = JSON.parse(line) as JournalEntry;
					if (entry.type === "retry" || entry.type === "workspace_retry" || entry.type === "workspace_complete") {
						retryEntries.push(entry);
					}
				} catch {
					// Skip corrupted lines
				}
			}

			// Build retry state tracking
			this.buildRetryStates(retryEntries);

			// Detect retry hotspots
			const hotspots = this.detectRetryHotspots();
			signals.push(...hotspots.signals);
			timelineEvents.push(...hotspots.timelineEvents);

			// Detect failure patterns
			const failurePatterns = this.detectFailurePatterns(retryEntries);
			signals.push(...failurePatterns.signals);
			timelineEvents.push(...failurePatterns.timelineEvents);
		} catch (error) {
			errors.push(`Failed to analyze execution journal: ${error instanceof Error ? error.message : String(error)}`);
		}

		return { observations, signals, timelineEvents, errors };
	}

	/**
	 * Build in-memory retry state from journal entries.
	 */
	private buildRetryStates(entries: JournalEntry[]): void {
		this.retryStates.clear();

		for (const entry of entries) {
			if (!entry.workspaceId) continue;

			if (entry.type === "retry" || entry.type === "workspace_retry") {
				const existing = this.retryStates.get(entry.workspaceId);

				if (existing) {
					existing.retryCount++;
					existing.lastRetryAt = entry.timestamp;
					existing.lastError = entry.error || existing.lastError;
				} else {
					this.retryStates.set(entry.workspaceId, {
						workspaceId: entry.workspaceId,
						retryCount: 1,
						firstRetryAt: entry.timestamp,
						lastRetryAt: entry.timestamp,
						lastError: entry.error || null,
					});
				}
			}

			// Reset retry count on successful completion
			if (entry.type === "workspace_complete" && entry.verdict === "complete") {
				const existing = this.retryStates.get(entry.workspaceId);
				if (existing && existing.retryCount > 0) {
					// Workspace completed - clear retry state if the retry was resolved
					this.retryStates.delete(entry.workspaceId);
				}
			}
		}
	}

	/**
	 * Detect workspaces with 3+ retries (retry hotspot signal).
	 */
	private detectRetryHotspots(): { signals: BrainSignal[]; timelineEvents: BrainTimelineEvent[] } {
		const signals: BrainSignal[] = [];
		const timelineEvents: BrainTimelineEvent[] = [];

		for (const [workspaceId, state] of this.retryStates.entries()) {
			if (state.retryCount >= 3) {
				const _evidence: SourceRef[] = [
					{
						type: "journal",
						path: `.pi/execution-journal.ndjson`,
					},
				];

				const signal = createBrainSignal({
					observationIds: [],
					pattern: `retry_hotspot:workspace:${state.retryCount}+`,
					summary: `Workspace '${workspaceId}' has experienced ${state.retryCount} consecutive retries. Last error: ${state.lastError || "unknown"}`,
					confidence: Math.min(0.5 + state.retryCount * 0.1, 0.95),
					severity: state.retryCount >= 5 ? "critical" : "warning",
					metadata: {
						workspaceId,
						retryCount: state.retryCount,
						firstRetryAt: state.firstRetryAt,
						lastRetryAt: state.lastRetryAt,
						lastError: state.lastError,
					},
				});

				signals.push(signal);

				timelineEvents.push(
					createBrainTimelineEvent({
						eventType: "signal",
						severity: signal.severity,
						workspaceId,
						data: {
							signalId: signal.id,
							pattern: signal.pattern,
							retryCount: state.retryCount,
						},
					}),
				);
			}
		}

		return { signals, timelineEvents };
	}

	/**
	 * Detect recurring failure patterns across workspaces.
	 */
	private detectFailurePatterns(entries: JournalEntry[]): {
		signals: BrainSignal[];
		timelineEvents: BrainTimelineEvent[];
	} {
		const signals: BrainSignal[] = [];
		const timelineEvents: BrainTimelineEvent[] = [];

		// Group failures by error message
		const errorGroups = new Map<string, { workspaceIds: string[]; count: number; lastError: string }>();
		// Group by role
		const roleFailures = new Map<string, { workspaceIds: string[]; count: number }>();

		for (const entry of entries) {
			if (entry.type === "workspace_complete" && entry.verdict === "failed" && entry.error) {
				// Normalize error key (first 100 chars to group similar errors)
				const errorKey = entry.error.slice(0, 100);

				const existing = errorGroups.get(errorKey) || {
					workspaceIds: [],
					count: 0,
					lastError: entry.error,
				};
				if (entry.workspaceId && !existing.workspaceIds.includes(entry.workspaceId)) {
					existing.workspaceIds.push(entry.workspaceId);
				}
				existing.count++;
				errorGroups.set(errorKey, existing);

				// Track by role
				if (entry.role) {
					const roleExisting = roleFailures.get(entry.role) || {
						workspaceIds: [],
						count: 0,
					};
					if (entry.workspaceId && !roleExisting.workspaceIds.includes(entry.workspaceId)) {
						roleExisting.workspaceIds.push(entry.workspaceId);
					}
					roleExisting.count++;
					roleFailures.set(entry.role, roleExisting);
				}
			}
		}

		// Emit signals for repeated failures (3+ same error)
		for (const [errorKey, group] of errorGroups.entries()) {
			if (group.count >= 3) {
				const _evidence: SourceRef[] = [
					{
						type: "journal",
						path: `.pi/execution-journal.ndjson`,
					},
				];

				const signal = createBrainSignal({
					observationIds: [],
					pattern: `failure_pattern:recurring:${group.count}+`,
					summary: `Recurring failure detected: '${errorKey.slice(0, 80)}...' occurred ${group.count} times across ${group.workspaceIds.length} workspace(s)`,
					confidence: Math.min(0.5 + group.count * 0.1, 0.95),
					severity: group.count >= 5 ? "critical" : "warning",
					metadata: {
						errorFragment: errorKey,
						occurrenceCount: group.count,
						affectedWorkspaces: group.workspaceIds,
						lastError: group.lastError,
					},
				});

				signals.push(signal);

				timelineEvents.push(
					createBrainTimelineEvent({
						eventType: "signal",
						severity: signal.severity,
						data: {
							signalId: signal.id,
							pattern: signal.pattern,
							occurrenceCount: group.count,
						},
					}),
				);
			}
		}

		// Emit signals for role-level failure patterns
		for (const [role, group] of roleFailures.entries()) {
			if (group.count >= 3) {
				const _evidence: SourceRef[] = [
					{
						type: "journal",
						path: `.pi/execution-journal.ndjson`,
					},
				];

				const signal = createBrainSignal({
					observationIds: [],
					pattern: `failure_pattern:role:${role}:${group.count}+`,
					summary: `Role '${role}' has experienced ${group.count} failures across ${group.workspaceIds.length} workspace(s)`,
					confidence: 0.7,
					severity: "warning",
					metadata: {
						role,
						failureCount: group.count,
						affectedWorkspaces: group.workspaceIds,
					},
				});

				signals.push(signal);

				timelineEvents.push(
					createBrainTimelineEvent({
						eventType: "signal",
						severity: "warning",
						data: {
							signalId: signal.id,
							pattern: signal.pattern,
							role,
							failureCount: group.count,
						},
					}),
				);
			}
		}

		return { signals, timelineEvents };
	}
}

// ── Observation Engine ─────────────────────────────────────────────────

/**
 * Observation Engine V0
 *
 * Runs a set of observers and collects their output into the brain timeline.
 * Each observer reads from a specific source and produces observations,
 * signals, and timeline events.
 */
export class ObservationEngine {
	private config: ObservationEngineConfig;
	private observers: Observer[] = [];

	constructor(config: ObservationEngineConfig) {
		this.config = config;
	}

	/**
	 * Register an observer.
	 */
	addObserver(observer: Observer): void {
		this.observers.push(observer);
	}

	/**
	 * Register all default observers.
	 */
	addDefaultObservers(): void {
		this.addObserver(
			new QueueHealthObserver({
				workspaceRoot: this.config.workspaceRoot,
				piDir: this.config.piDir,
			}),
		);
		this.addObserver(
			new ExecutionJournalObserver({
				workspaceRoot: this.config.workspaceRoot,
				piDir: this.config.piDir,
			}),
		);
		this.addObserver(
			new RetryFailureSignalExtractor({
				workspaceRoot: this.config.workspaceRoot,
				piDir: this.config.piDir,
			}),
		);
	}

	/**
	 * Run a single observation cycle.
	 *
	 * Executes all registered observers and stores their output
	 * in the brain timeline store.
	 */
	async observe(): Promise<ObservationResult> {
		const allObservations: BrainObservation[] = [];
		const allSignals: BrainSignal[] = [];
		const allTimelineEvents: BrainTimelineEvent[] = [];
		const allErrors: string[] = [];

		for (const observer of this.observers) {
			try {
				const output = await observer.observe();
				allObservations.push(...output.observations);
				allSignals.push(...output.signals);
				allTimelineEvents.push(...output.timelineEvents);
				allErrors.push(...output.errors);
			} catch (error) {
				allErrors.push(
					`Observer '${observer.name}' failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		// Write all timeline events to the store
		for (const event of allTimelineEvents) {
			try {
				await this.config.timelineStore.append(event);
			} catch (err) {
				allErrors.push(`Failed to append timeline event: ${String(err)}`);
			}
		}

		return {
			observations: allObservations,
			signals: allSignals,
			timelineEvents: allTimelineEvents,
			errors: allErrors,
		};
	}
}

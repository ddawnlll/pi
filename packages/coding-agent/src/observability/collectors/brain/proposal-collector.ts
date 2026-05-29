/**
 * Proposal Collector — Workspace 25.G
 *
 * Collects observable telemetry from proposal lifecycle (P16.A–F) and converts
 * them into standardized ObservabilityEvent records for the telemetry store.
 *
 * Handles:
 * - Proposal lifecycle transitions (draft → pending_approval → approved/rejected/expired/executed)
 * - Proposal score changes
 * - Deduplication events (suppressed duplicates)
 * - Inbox entry lifecycle
 *
 * ## Autonomous Design
 *
 * All collection respects:
 * - **Budget**: Maximum events collected per cycle, max entries overall
 * - **Cooldown**: Minimum time between collection of the same event type
 * - **Dedupe**: Content-hash deduplication within a configurable window
 * - **Stop-conditions**: Early exit when budget or time limits are hit
 *
 * ## Diagnostics
 *
 * Every failure surfaces an evidence-backed diagnostic with at minimum
 * a placeholder entry rather than silent failure.
 *
 * @module observability/collectors/brain/proposal-collector
 */

import { createHash } from "node:crypto";
import type { Proposal, ProposalStatus } from "../../../brain/proposals/types.js";
import { createObservabilityEvent, createTraceContext } from "../../schema.js";
import type { ObservabilityEvent, ObservabilitySeverity, ObservabilityStatus } from "../../types.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Cooldown tracking for the proposal collector.
 */
export interface ProposalCollectorCooldown {
	/** ISO 8601 timestamp when cooldown expires (null if not in cooldown) */
	expiresAt: string | null;
	/** Human-readable reason for the cooldown */
	reason: string | null;
	/** How many times this key has been collected (for diagnostics) */
	collectionCount: number;
	/** ISO 8601 timestamp of last collection */
	lastCollectedAt: string | null;
}

/**
 * Deduplication tracking entry.
 */
export interface ProposalCollectorDedupeEntry {
	/** Content hash for deduplication */
	contentHash: string;
	/** ISO 8601 timestamp of first occurrence */
	firstSeenAt: string;
	/** Number of suppressed duplicates */
	suppressedCount: number;
}

/**
 * Budget configuration for proposal collection.
 */
export interface ProposalCollectorBudget {
	/** Maximum events to collect per collection cycle (default: 30) */
	maxPerCycle: number;
	/** Maximum total events retained in the collector buffer (default: 300) */
	maxTotal: number;
	/** Maximum CPU time (ms) spent collecting per cycle (default: 150) */
	maxTimeMs: number;
}

/**
 * Default budget for proposal collection.
 */
export const DEFAULT_PROPOSAL_COLLECTOR_BUDGET: ProposalCollectorBudget = {
	maxPerCycle: 30,
	maxTotal: 300,
	maxTimeMs: 150,
};

/**
 * Deduplication configuration.
 */
export interface ProposalCollectorDedupeConfig {
	/** Whether deduplication is enabled (default: true) */
	enabled: boolean;
	/** Time window in ms for considering events as duplicates (default: 60_000) */
	windowMs: number;
}

/**
 * Default dedupe configuration.
 */
export const DEFAULT_PROPOSAL_COLLECTOR_DEDUPE: ProposalCollectorDedupeConfig = {
	enabled: true,
	windowMs: 60_000,
};

/**
 * Stop condition for proposal collection.
 */
export interface ProposalCollectorStopCondition {
	/** Whether the stop condition has been triggered */
	triggered: boolean;
	/** Human-readable condition description */
	condition: string;
	/** ISO 8601 timestamp when triggered (null if not triggered) */
	triggeredAt: string | null;
	/** Additional detail */
	detail: string | null;
}

/**
 * Full diagnostic state for the proposal collector.
 */
export interface ProposalCollectorDiagnostics {
	/** Total events collected since creation */
	totalCollected: number;
	/** Total events deduplicated (suppressed) */
	totalDeduplicated: number;
	/** Number of cycles that hit the maxPerCycle budget */
	cyclesHitBudget: number;
	/** Number of cycles that hit the maxTimeMs budget */
	cyclesHitTimeLimit: number;
	/** Current buffer size */
	bufferSize: number;
	/** Cooldown states by key */
	cooldowns: Record<string, ProposalCollectorCooldown>;
	/** Stop condition states */
	stopConditions: ProposalCollectorStopCondition[];
	/** Whether the collector has been stopped */
	stopped: boolean;
	/** Error message if the collector is in an error state */
	error: string | null;
}

/**
 * Collected proposal buffer entry.
 */
export interface ProposalCollectorBufferEntry {
	/** The observability event */
	event: ObservabilityEvent;
	/** Original proposal event type (for filtering) */
	proposalEventType: string;
	/** ISO 8601 timestamp of collection */
	collectedAt: string;
	/** Source component name */
	source: string;
}

/**
 * Event types emitted by the proposal collector.
 */
export type ProposalCollectorEventType =
	| "proposal_created"
	| "proposal_status_changed"
	| "proposal_approved"
	| "proposal_rejected"
	| "proposal_expired"
	| "proposal_executed"
	| "proposal_superseded"
	| "proposal_scored"
	| "proposal_deduplicated"
	| "proposal_inbox_added"
	| "proposal_error";

/**
 * Input for collecting a proposal status change.
 */
export interface ProposalStatusChangeInput {
	proposal: Proposal;
	previousStatus: ProposalStatus;
}

/**
 * Input for collecting a deduplication event.
 */
export interface ProposalDedupeInput {
	proposal: Proposal;
	/** The ID of the duplicate proposal that was suppressed */
	duplicateId: string;
	/** Reason the duplicate was suppressed */
	reason: string;
}

/**
 * Input for collecting a proposal score.
 */
export interface ProposalScoreInput {
	proposal: Proposal;
	/** If true, this score represents a re-score (change) */
	isRescore: boolean;
	/** Previous total score if rescore, undefined otherwise */
	previousTotalScore?: number;
}

// ─────────────────────────────────────────────────────────────────────
// ProposalCollector
// ─────────────────────────────────────────────────────────────────────

/**
 * Collects proposal lifecycle telemetry as observability events.
 *
 * Handles Proposal lifecycle transitions, scoring events, deduplication
 * events, and inbox additions — all respecting budget, cooldown, dedupe,
 * and stop-condition constraints.
 */
export class ProposalCollector {
	private buffer: ProposalCollectorBufferEntry[] = [];
	private cooldowns: Map<string, ProposalCollectorCooldown> = new Map();
	private dedupeEntries: Map<string, ProposalCollectorDedupeEntry> = new Map();
	private stopConditions: ProposalCollectorStopCondition[] = [];

	private totalCollected = 0;
	private totalDeduplicated = 0;
	private cyclesHitBudget = 0;
	private cyclesHitTimeLimit = 0;
	private stopped = false;
	private error: string | null = null;

	private budget: ProposalCollectorBudget;
	private dedupeConfig: ProposalCollectorDedupeConfig;
	private cooldownMs: number;

	constructor(
		budget?: Partial<ProposalCollectorBudget>,
		dedupeConfig?: Partial<ProposalCollectorDedupeConfig>,
		cooldownMs = 15_000,
	) {
		this.budget = { ...DEFAULT_PROPOSAL_COLLECTOR_BUDGET, ...budget };
		this.dedupeConfig = { ...DEFAULT_PROPOSAL_COLLECTOR_DEDUPE, ...dedupeConfig };
		this.cooldownMs = cooldownMs;
	}

	// ── Configuration ────────────────────────────────────────────────

	/**
	 * Update budget configuration.
	 */
	setBudget(budget: Partial<ProposalCollectorBudget>): void {
		this.budget = { ...this.budget, ...budget };
	}

	/**
	 * Get current budget configuration.
	 */
	getBudget(): ProposalCollectorBudget {
		return { ...this.budget };
	}

	/**
	 * Update deduplication configuration.
	 */
	setDedupeConfig(config: Partial<ProposalCollectorDedupeConfig>): void {
		this.dedupeConfig = { ...this.dedupeConfig, ...config };
	}

	/**
	 * Get current dedupe configuration.
	 */
	getDedupeConfig(): ProposalCollectorDedupeConfig {
		return { ...this.dedupeConfig };
	}

	/**
	 * Set cooldown duration in milliseconds.
	 */
	setCooldownMs(ms: number): void {
		this.cooldownMs = ms;
	}

	/**
	 * Get current cooldown duration.
	 */
	getCooldownMs(): number {
		return this.cooldownMs;
	}

	// ── Lifecycle ────────────────────────────────────────────────────

	/**
	 * Check whether the collector is stopped.
	 */
	isStopped(): boolean {
		return this.stopped;
	}

	/**
	 * Stop the collector. Prevents further collection until reset().
	 */
	stop(condition?: string, detail?: string): void {
		this.stopped = true;
		if (condition) {
			this.stopConditions.push({
				triggered: true,
				condition,
				triggeredAt: new Date().toISOString(),
				detail: detail ?? null,
			});
		}
	}

	/**
	 * Reset the collector to its initial state, clearing all state.
	 */
	reset(): void {
		this.buffer = [];
		this.cooldowns.clear();
		this.dedupeEntries.clear();
		this.stopConditions = [];
		this.totalCollected = 0;
		this.totalDeduplicated = 0;
		this.cyclesHitBudget = 0;
		this.cyclesHitTimeLimit = 0;
		this.stopped = false;
		this.error = null;
	}

	// ── Stop conditions ──────────────────────────────────────────────

	/**
	 * Add a stop condition to the collector.
	 */
	addStopCondition(condition: string, detail?: string): void {
		this.stopConditions.push({
			triggered: false,
			condition,
			triggeredAt: null,
			detail: detail ?? null,
		});
	}

	/**
	 * Trigger a stop condition by key/condition name.
	 */
	triggerStopCondition(conditionName: string): boolean {
		for (const sc of this.stopConditions) {
			if (sc.condition === conditionName && !sc.triggered) {
				sc.triggered = true;
				sc.triggeredAt = new Date().toISOString();
				return true;
			}
		}
		return false;
	}

	/**
	 * Check if any stop condition is triggered.
	 */
	hasStopConditionTriggered(): boolean {
		return this.stopConditions.some((sc) => sc.triggered);
	}

	/**
	 * Get all stop conditions.
	 */
	getStopConditions(): ProposalCollectorStopCondition[] {
		return this.stopConditions.map((sc) => ({ ...sc }));
	}

	// ── Collection ───────────────────────────────────────────────────

	/**
	 * Collect a proposal creation event.
	 *
	 * @param proposal - The newly created proposal
	 * @returns The collected observability event, or null if suppressed
	 */
	collectProposalCreated(proposal: Proposal): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = `proposal:created:${proposal.type}`;

		// Cooldown check
		if (this.isOnCooldown(collectionKey)) return null;

		// Dedupe check
		const stablePayload = {
			id: proposal.id,
			type: proposal.type,
			status: proposal.status,
			title: proposal.title,
		};
		const contentHash = this.computeContentHash(stablePayload);
		if (this.isDuplicate(contentHash, proposal.createdAt)) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const event = this.proposalCreatedToEvent(proposal);

		this.addToBuffer(event, "proposal_created", "brain/proposal-generator");
		this.trackCooldown(collectionKey);
		this.trackDedupe(contentHash, proposal.createdAt);

		this.totalCollected++;

		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return event;
	}

	/**
	 * Collect a proposal status change event.
	 *
	 * @param input - Status change details with proposal and previous status
	 * @returns The collected observability event, or null if suppressed
	 */
	collectProposalStatusChange(input: ProposalStatusChangeInput): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = `proposal:status:${input.previousStatus}->${input.proposal.status}`;

		// Cooldown check
		if (this.isOnCooldown(collectionKey)) return null;

		// Dedupe check
		const stablePayload = {
			id: input.proposal.id,
			from: input.previousStatus,
			to: input.proposal.status,
		};
		const contentHash = this.computeContentHash(stablePayload);
		if (this.isDuplicate(contentHash, input.proposal.updatedAt)) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const event = this.proposalStatusChangeToEvent(input);

		this.addToBuffer(event, `proposal_${input.proposal.status}`, "brain/proposal-store");
		this.trackCooldown(collectionKey);
		this.trackDedupe(contentHash, input.proposal.updatedAt);

		this.totalCollected++;

		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return event;
	}

	/**
	 * Collect a proposal score event.
	 *
	 * @param input - Score input with proposal and scoring metadata
	 * @returns The collected observability event, or null if suppressed
	 */
	collectProposalScore(input: ProposalScoreInput): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = `proposal:score:${input.proposal.id}`;

		// Cooldown check — allow rescore events more frequently
		const effectiveCooldownMs = input.isRescore ? Math.floor(this.cooldownMs / 2) : this.cooldownMs;

		// Budget check before core logic
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const event = this.proposalScoreToEvent(input);

		this.addToBuffer(event, "proposal_scored", "brain/proposal-scoring");
		this.trackCooldown(collectionKey, undefined, effectiveCooldownMs);

		this.totalCollected++;

		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return event;
	}

	/**
	 * Collect a proposal deduplication event.
	 *
	 * @param input - Deduplication details
	 * @returns The collected observability event, or null if suppressed
	 */
	collectProposalDeduplicated(input: ProposalDedupeInput): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		const collectionKey = "proposal:deduplicated";

		// Cooldown check
		if (this.isOnCooldown(collectionKey)) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const event = this.proposalDeduplicationToEvent(input);

		this.addToBuffer(event, "proposal_deduplicated", "brain/proposal-dedup");
		this.trackCooldown(collectionKey);

		this.totalCollected++;

		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return event;
	}

	/**
	 * Collect a generic error event with evidence-backed diagnostics.
	 *
	 * @param source - The component that encountered the error
	 * @param message - Human-readable error description
	 * @param data - Additional diagnostic data
	 * @returns The collected observability event, or null if suppressed
	 */
	collectError(source: string, message: string, data?: Record<string, unknown>): ObservabilityEvent | null {
		if (this.stopped) return null;
		if (this.hasStopConditionTriggered()) return null;

		// Cooldown check with shorter cd for errors
		const collectionKey = `proposal:error:${source}`;
		if (this.isOnCooldown(collectionKey)) return null;

		// Budget check (total buffer)
		if (this.budget.maxTotal > 0 && this.buffer.length >= this.budget.maxTotal) {
			this.cyclesHitBudget++;
			return null;
		}

		const startTime = Date.now();
		const event = this.errorToEvent(source, message, data);

		this.addToBuffer(event, "proposal_error", source);
		this.trackCooldown(collectionKey);

		this.totalCollected++;

		const elapsed = Date.now() - startTime;
		if (elapsed >= this.budget.maxTimeMs) {
			this.cyclesHitTimeLimit++;
		}

		return event;
	}

	/**
	 * Collect a batch of proposal events in a single cycle.
	 *
	 * Respects per-cycle budget (maxPerCycle) and time budget (maxTimeMs).
	 * Returns the number of events successfully collected.
	 *
	 * @param created - Newly created proposals
	 * @param statusChanges - Status change inputs
	 * @param scores - Score inputs
	 * @param deduped - Deduplication inputs
	 * @returns Count of successfully collected events
	 */
	collectBatch(
		created: Proposal[] = [],
		statusChanges: ProposalStatusChangeInput[] = [],
		scores: ProposalScoreInput[] = [],
		deduped: ProposalDedupeInput[] = [],
	): number {
		if (this.stopped) return 0;
		if (this.hasStopConditionTriggered()) return 0;

		const startTime = Date.now();
		let collected = 0;
		let hitBudget = false;

		// Collect creation events
		for (const proposal of created) {
			if (collected >= this.budget.maxPerCycle) {
				hitBudget = true;
				break;
			}
			const elapsed = Date.now() - startTime;
			if (elapsed >= this.budget.maxTimeMs) {
				this.cyclesHitTimeLimit++;
				break;
			}
			if (this.collectProposalCreated(proposal) !== null) {
				collected++;
			}
		}

		// Collect status changes (respect remaining per-cycle budget)
		if (!hitBudget) {
			for (const sc of statusChanges) {
				if (collected >= this.budget.maxPerCycle) {
					hitBudget = true;
					break;
				}
				const elapsed = Date.now() - startTime;
				if (elapsed >= this.budget.maxTimeMs) {
					this.cyclesHitTimeLimit++;
					break;
				}
				if (this.collectProposalStatusChange(sc) !== null) {
					collected++;
				}
			}
		}

		// Collect scores (respect remaining per-cycle budget)
		if (!hitBudget) {
			for (const score of scores) {
				if (collected >= this.budget.maxPerCycle) {
					hitBudget = true;
					break;
				}
				const elapsed = Date.now() - startTime;
				if (elapsed >= this.budget.maxTimeMs) {
					this.cyclesHitTimeLimit++;
					break;
				}
				if (this.collectProposalScore(score) !== null) {
					collected++;
				}
			}
		}

		// Collect deduplication events (respect remaining per-cycle budget)
		if (!hitBudget) {
			for (const dedup of deduped) {
				if (collected >= this.budget.maxPerCycle) {
					hitBudget = true;
					break;
				}
				const elapsed = Date.now() - startTime;
				if (elapsed >= this.budget.maxTimeMs) {
					this.cyclesHitTimeLimit++;
					break;
				}
				if (this.collectProposalDeduplicated(dedup) !== null) {
					collected++;
				}
			}
		}

		if (hitBudget) {
			this.cyclesHitBudget++;
		}

		return collected;
	}

	// ── Buffer Access ────────────────────────────────────────────────

	/**
	 * Drain all buffered events and return them.
	 * Clears the buffer after draining.
	 *
	 * @returns Array of buffered observability events
	 */
	drain(): ProposalCollectorBufferEntry[] {
		const entries = [...this.buffer];
		this.buffer = [];
		return entries;
	}

	/**
	 * Get current buffer size.
	 */
	bufferSize(): number {
		return this.buffer.length;
	}

	/**
	 * Get all buffered entries without draining.
	 */
	peek(limit?: number): ProposalCollectorBufferEntry[] {
		if (limit && limit > 0) {
			return this.buffer.slice(0, limit);
		}
		return [...this.buffer];
	}

	// ── Diagnostics ──────────────────────────────────────────────────

	/**
	 * Get full diagnostics including cooldowns, dedupe stats, budget hits.
	 */
	getDiagnostics(): ProposalCollectorDiagnostics {
		const cooldownsRecord: Record<string, ProposalCollectorCooldown> = {};
		for (const [key, value] of this.cooldowns) {
			cooldownsRecord[key] = { ...value };
		}

		return {
			totalCollected: this.totalCollected,
			totalDeduplicated: this.totalDeduplicated,
			cyclesHitBudget: this.cyclesHitBudget,
			cyclesHitTimeLimit: this.cyclesHitTimeLimit,
			bufferSize: this.buffer.length,
			cooldowns: cooldownsRecord,
			stopConditions: this.getStopConditions(),
			stopped: this.stopped,
			error: this.error,
		};
	}

	/**
	 * Set an error state with a diagnostic message.
	 */
	setError(message: string): void {
		this.error = message;
	}

	/**
	 * Clear the error state.
	 */
	clearError(): void {
		this.error = null;
	}

	// ── Private ──────────────────────────────────────────────────────

	private proposalCreatedToEvent(proposal: Proposal): ObservabilityEvent {
		const ctx = createTraceContext({
			name: `brain/proposal_created:${proposal.type}`,
			correlationId: null,
			projectId: null,
			planExecutionId: null,
			workspaceExecutionId: null,
		});

		return createObservabilityEvent(ctx, {
			eventType: "proposal_created",
			source: "brain/proposal-generator",
			severity: "info",
			status: "ok",
			name: `proposal:${proposal.id}`,
			message: `Proposal created: "${proposal.title}" (${proposal.type})`,
			data: {
				proposalId: proposal.id,
				type: proposal.type,
				title: proposal.title,
				status: proposal.status,
				submittedBy: proposal.submittedBy,
				score: {
					total: proposal.score.total,
					novelty: proposal.score.novelty,
					confidence: proposal.score.confidence,
					urgency: proposal.score.urgency,
					feasibility: proposal.score.feasibility,
				},
				risk: {
					level: proposal.risk.level,
					factors: proposal.risk.factors,
					affectedSystems: proposal.risk.affectedSystems,
				},
				evidenceConfidence: proposal.evidence.confidence,
				evidenceSummary: proposal.evidence.evidenceSummary,
				tags: proposal.tags,
			},
		});
	}

	private proposalStatusChangeToEvent(input: ProposalStatusChangeInput): ObservabilityEvent {
		const { proposal, previousStatus } = input;
		const eventType = this.proposalStatusToEventType(proposal.status);
		const ctx = createTraceContext({
			name: `brain/${eventType}`,
			correlationId: null,
			projectId: null,
			planExecutionId: proposal.executedAsPlanId ?? null,
			workspaceExecutionId: null,
		});

		const severity = this.mapProposalStatusToSeverity(proposal.status);
		const status = this.mapProposalStatusToObservabilityStatus(proposal.status);

		return createObservabilityEvent(ctx, {
			eventType,
			source: "brain/proposal-store",
			severity,
			status,
			name: `proposal:${proposal.id}`,
			message: this.buildStatusChangeMessage(proposal, previousStatus),
			data: {
				proposalId: proposal.id,
				type: proposal.type,
				title: proposal.title,
				from: previousStatus,
				to: proposal.status,
				approvedBy: proposal.approvedBy ?? null,
				rejectedBy: proposal.rejectedBy ?? null,
				rejectionReason: proposal.rejectionReason ?? null,
				executedAsPlanId: proposal.executedAsPlanId ?? null,
				score: {
					total: proposal.score.total,
					confidence: proposal.score.confidence,
				},
			},
		});
	}

	private proposalScoreToEvent(input: ProposalScoreInput): ObservabilityEvent {
		const { proposal, isRescore, previousTotalScore } = input;
		const ctx = createTraceContext({
			name: "brain/proposal_scored",
			correlationId: null,
			projectId: null,
			planExecutionId: null,
			workspaceExecutionId: null,
		});

		const scoreDelta = previousTotalScore !== undefined ? proposal.score.total - previousTotalScore : 0;

		return createObservabilityEvent(ctx, {
			eventType: "proposal_scored",
			source: "brain/proposal-scoring",
			severity: "info",
			status: "ok",
			name: `proposal:score:${proposal.id}`,
			message: `Proposal "${proposal.title}" scored ${(proposal.score.total * 100).toFixed(0)}/100${isRescore ? ` (delta: ${(scoreDelta * 100).toFixed(0)} pts)` : ""}`,
			data: {
				proposalId: proposal.id,
				type: proposal.type,
				isRescore,
				previousTotalScore: previousTotalScore ?? null,
				score: {
					total: proposal.score.total,
					novelty: proposal.score.novelty,
					confidence: proposal.score.confidence,
					urgency: proposal.score.urgency,
					feasibility: proposal.score.feasibility,
				},
			},
		});
	}

	private proposalDeduplicationToEvent(input: ProposalDedupeInput): ObservabilityEvent {
		const { proposal, duplicateId, reason } = input;
		const ctx = createTraceContext({
			name: "brain/proposal_deduplicated",
			correlationId: null,
			projectId: null,
			planExecutionId: null,
			workspaceExecutionId: null,
		});

		return createObservabilityEvent(ctx, {
			eventType: "proposal_deduplicated",
			source: "brain/proposal-dedup",
			severity: "info",
			status: "ok",
			name: `proposal:dedup:${proposal.id}`,
			message: `Duplicate suppressed: "${proposal.title}" (${duplicateId}) — ${reason}`,
			data: {
				proposalId: proposal.id,
				duplicateId,
				reason,
				type: proposal.type,
				title: proposal.title,
			},
		});
	}

	private errorToEvent(source: string, message: string, data?: Record<string, unknown>): ObservabilityEvent {
		const ctx = createTraceContext({
			name: "brain/proposal_error",
			correlationId: null,
			projectId: null,
			planExecutionId: null,
			workspaceExecutionId: null,
		});

		return createObservabilityEvent(ctx, {
			eventType: "proposal_error",
			source,
			severity: "error",
			status: "error",
			name: `proposal:error:${source}`,
			message,
			data: {
				errorSource: source,
				errorMessage: message,
				...data,
			},
		});
	}

	private addToBuffer(event: ObservabilityEvent, proposalEventType: string, source: string): void {
		const entry: ProposalCollectorBufferEntry = {
			event,
			proposalEventType,
			source,
			collectedAt: new Date().toISOString(),
		};
		this.buffer.push(entry);
	}

	private computeContentHash(data: Record<string, unknown>): string {
		const hash = createHash("sha256");
		hash.update(JSON.stringify(data));
		return hash.digest("hex");
	}

	private isDuplicate(contentHash: string, timestamp: string): boolean {
		if (!this.dedupeConfig.enabled) return false;

		const existing = this.dedupeEntries.get(contentHash);
		if (!existing) return false;

		const eventTime = new Date(timestamp).getTime();
		const firstTime = new Date(existing.firstSeenAt).getTime();
		const elapsed = eventTime - firstTime;

		if (elapsed <= this.dedupeConfig.windowMs) {
			existing.suppressedCount++;
			this.totalDeduplicated++;
			return true;
		}

		// Outside window, remove and allow through
		this.dedupeEntries.delete(contentHash);
		return false;
	}

	private trackDedupe(contentHash: string, timestamp: string): void {
		if (!this.dedupeConfig.enabled) return;
		this.dedupeEntries.set(contentHash, {
			contentHash,
			firstSeenAt: timestamp,
			suppressedCount: 0,
		});
	}

	private isOnCooldown(key: string): boolean {
		const cooldown = this.cooldowns.get(key);
		if (!cooldown || !cooldown.expiresAt) return false;

		const now = Date.now();
		const expires = new Date(cooldown.expiresAt).getTime();

		if (now < expires) {
			return true;
		}

		// Expired — clear it
		this.cooldowns.delete(key);
		return false;
	}

	private trackCooldown(key: string, reason?: string, overrideCooldownMs?: number): void {
		const effectiveMs = overrideCooldownMs ?? this.cooldownMs;
		const expiresAt = new Date(Date.now() + effectiveMs).toISOString();
		const existing = this.cooldowns.get(key);

		this.cooldowns.set(key, {
			expiresAt,
			reason: reason ?? null,
			collectionCount: (existing?.collectionCount ?? 0) + 1,
			lastCollectedAt: new Date().toISOString(),
		});
	}

	/**
	 * Map ProposalStatus to the appropriate event type.
	 */
	private proposalStatusToEventType(status: ProposalStatus): string {
		switch (status) {
			case "draft":
				return "proposal_created";
			case "pending_approval":
				return "proposal_status_changed";
			case "approved":
				return "proposal_approved";
			case "rejected":
				return "proposal_rejected";
			case "expired":
				return "proposal_expired";
			case "executed":
				return "proposal_executed";
			case "superseded":
				return "proposal_superseded";
			default:
				return "proposal_status_changed";
		}
	}

	/**
	 * Map ProposalStatus to observability severity.
	 */
	private mapProposalStatusToSeverity(status: ProposalStatus): ObservabilitySeverity {
		switch (status) {
			case "draft":
			case "pending_approval":
				return "info";
			case "approved":
			case "executed":
				return "info";
			case "rejected":
			case "superseded":
			case "expired":
				return "warning";
			default:
				return "info";
		}
	}

	/**
	 * Map ProposalStatus to observability status.
	 */
	private mapProposalStatusToObservabilityStatus(status: ProposalStatus): ObservabilityStatus {
		switch (status) {
			case "draft":
			case "pending_approval":
				return "running";
			case "approved":
			case "executed":
				return "ok";
			case "rejected":
			case "superseded":
			case "expired":
				return "ok";
			default:
				return "running";
		}
	}

	/**
	 * Build a human-readable message for a status change.
	 */
	private buildStatusChangeMessage(proposal: Proposal, previousStatus: ProposalStatus): string {
		switch (proposal.status) {
			case "approved":
				return `Proposal "${proposal.title}" approved${proposal.approvedBy ? ` by ${proposal.approvedBy}` : ""}`;
			case "rejected":
				return `Proposal "${proposal.title}" rejected${proposal.rejectionReason ? `: ${proposal.rejectionReason}` : ""}`;
			case "expired":
				return `Proposal "${proposal.title}" expired`;
			case "executed":
				return `Proposal "${proposal.title}" executed${proposal.executedAsPlanId ? ` as plan ${proposal.executedAsPlanId}` : ""}`;
			case "superseded":
				return `Proposal "${proposal.title}" superseded by a newer proposal`;
			case "draft":
			case "pending_approval":
				return `Proposal "${proposal.title}" status changed: ${previousStatus} → ${proposal.status}`;
			default:
				return `Proposal "${proposal.title}" status changed: ${previousStatus} → ${proposal.status}`;
		}
	}
}

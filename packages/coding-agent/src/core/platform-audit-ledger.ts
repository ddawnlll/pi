/**
 * Platform Audit Ledger - P11.M
 *
 * Platform-level audit ledger for orchestrator decisions, plan-intake optimizer
 * suggestions, extension lifecycle events, skill invocations, memory operations,
 * and policy decisions.
 *
 * Every platform action emits an audit event. No autonomous self-improvement
 * action can complete without an audit trace.
 *
 * Extends the governance ledger (P9.G7) with platform-specific event types.
 */

import type { GraphApprovalRecord } from "./graph-diff-engine.js";
import type { PlanIntakeAnalysis } from "./plan-intake-analyzer.js";

// ---------------------------------------------------------------------------
// Platform Audit Event Types
// ---------------------------------------------------------------------------

/**
 * Categories of platform audit events.
 */
export type PlatformAuditCategory =
	| "orchestrator"
	| "plan_intake"
	| "optimizer"
	| "extension"
	| "skill"
	| "memory"
	| "policy"
	| "registry"
	| "self_improvement"
	| "dashboard"
	| "approval";

/**
 * Severity of a platform audit event.
 */
export type PlatformAuditSeverity = "info" | "warning" | "error" | "critical";

/**
 * Outcome of a platform action.
 */
export type PlatformAuditOutcome =
	| "allowed"
	| "denied"
	| "pending_approval"
	| "approved"
	| "rejected"
	| "rolled_back"
	| "completed"
	| "failed"
	| "skipped";

/**
 * A single platform audit event.
 */
export interface PlatformAuditEvent {
	/** Unique event ID */
	id: string;
	/** Event category */
	category: PlatformAuditCategory;
	/** Event severity */
	severity: PlatformAuditSeverity;
	/** Outcome of the action */
	outcome: PlatformAuditOutcome;
	/** Timestamp of the event */
	timestamp: string;
	/** Actor that triggered the event */
	actor: string;
	/** Target of the action */
	target: string;
	/** Project context */
	project?: string;
	/** Plan or workspace context */
	phase?: string;
	/** Human-readable message */
	message: string;
	/** Detailed payload (optional) */
	detail?: Record<string, unknown>;
	/** Reference to a related approval record */
	approvalId?: string;
	/** Before/after state (where applicable) */
	beforeState?: string;
	afterState?: string;
	/** Rollback pointer (where applicable) */
	rollbackPointer?: string;
}

/**
 * Filter options for querying audit events.
 */
export interface AuditEventFilter {
	category?: PlatformAuditCategory;
	outcome?: PlatformAuditOutcome;
	severity?: PlatformAuditSeverity;
	actor?: string;
	target?: string;
	project?: string;
	phase?: string;
	approvalId?: string;
	fromTimestamp?: string;
	toTimestamp?: string;
	limit?: number;
	offset?: number;
}

/**
 * Summary statistics for audit events.
 */
export interface AuditSummary {
	totalEvents: number;
	eventsByCategory: Record<PlatformAuditCategory, number>;
	eventsByOutcome: Record<PlatformAuditOutcome, number>;
	eventsBySeverity: Record<PlatformAuditSeverity, number>;
	topActors: Array<{ actor: string; count: number }>;
	recentApprovals: number;
	recentDenials: number;
}

// ---------------------------------------------------------------------------
// Platform Audit Ledger
// ---------------------------------------------------------------------------

let eventIdCounter = 0;

function generateEventId(): string {
	eventIdCounter++;
	return `pevt-${eventIdCounter}-${Date.now()}`;
}

/**
 * Platform Audit Ledger
 *
 * Records every platform action with full context for traceability.
 * All autonomous self-improvement actions must create an audit trail.
 */
export class PlatformAuditLedger {
	private events: PlatformAuditEvent[] = [];
	private maxEvents: number;

	/**
	 * Create a PlatformAuditLedger.
	 *
	 * @param maxEvents - Maximum number of events to keep in memory (older events are pruned)
	 */
	constructor(maxEvents: number = 10000) {
		this.maxEvents = maxEvents;
	}

	/**
	 * Record a platform audit event.
	 *
	 * @param event - The event data (id will be auto-generated)
	 * @returns The recorded event with generated ID
	 */
	record(event: Omit<PlatformAuditEvent, "id">): PlatformAuditEvent {
		const fullEvent: PlatformAuditEvent = {
			...event,
			id: generateEventId(),
		};

		this.events.push(fullEvent);

		// Prune old events if over limit
		if (this.events.length > this.maxEvents) {
			this.events = this.events.slice(-this.maxEvents);
		}

		return fullEvent;
	}

	/**
	 * Query audit events with optional filters.
	 *
	 * @param filter - Filter criteria
	 * @returns Filtered and sorted events (newest first)
	 */
	query(filter?: AuditEventFilter): PlatformAuditEvent[] {
		let results = [...this.events];

		if (filter?.category) {
			results = results.filter((e) => e.category === filter.category);
		}
		if (filter?.outcome) {
			results = results.filter((e) => e.outcome === filter.outcome);
		}
		if (filter?.severity) {
			results = results.filter((e) => e.severity === filter.severity);
		}
		if (filter?.actor) {
			results = results.filter((e) => e.actor.includes(filter.actor!));
		}
		if (filter?.target) {
			results = results.filter((e) => e.target.includes(filter.target!));
		}
		if (filter?.project) {
			results = results.filter((e) => e.project === filter.project);
		}
		if (filter?.phase) {
			results = results.filter((e) => e.phase === filter.phase);
		}
		if (filter?.approvalId) {
			results = results.filter((e) => e.approvalId === filter.approvalId);
		}
		if (filter?.fromTimestamp) {
			results = results.filter((e) => e.timestamp >= filter.fromTimestamp!);
		}
		if (filter?.toTimestamp) {
			results = results.filter((e) => e.timestamp <= filter.toTimestamp!);
		}

		// Sort newest first
		results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

		// Apply pagination
		const offset = filter?.offset ?? 0;
		const limit = filter?.limit ?? results.length;
		results = results.slice(offset, offset + limit);

		return results;
	}

	/**
	 * Get audit summary statistics.
	 *
	 * @returns Summary object
	 */
	getSummary(): AuditSummary {
		const byCategory: Record<string, number> = {};
		const byOutcome: Record<string, number> = {};
		const bySeverity: Record<string, number> = {};
		const actorCounts: Record<string, number> = {};

		for (const event of this.events) {
			byCategory[event.category] = (byCategory[event.category] ?? 0) + 1;
			byOutcome[event.outcome] = (byOutcome[event.outcome] ?? 0) + 1;
			bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
			actorCounts[event.actor] = (actorCounts[event.actor] ?? 0) + 1;
		}

		const topActors = Object.entries(actorCounts)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([actor, count]) => ({ actor, count }));

		const recentApprovals = this.events.filter(
			(e) => e.outcome === "approved" || e.outcome === "allowed",
		).length;

		const recentDenials = this.events.filter(
			(e) => e.outcome === "denied" || e.outcome === "rejected",
		).length;

		return {
			totalEvents: this.events.length,
			eventsByCategory: byCategory as Record<PlatformAuditCategory, number>,
			eventsByOutcome: byOutcome as Record<PlatformAuditOutcome, number>,
			eventsBySeverity: bySeverity as Record<PlatformAuditSeverity, number>,
			topActors,
			recentApprovals,
			recentDenials,
		};
	}

	/**
	 * Get all events (for export/snapshot).
	 *
	 * @returns All stored events
	 */
	getAllEvents(): PlatformAuditEvent[] {
		return [...this.events];
	}

	/**
	 * Clear all events.
	 */
	clear(): void {
		this.events = [];
	}

	// -----------------------------------------------------------------------
	// Convenience methods for common platform events
	// -----------------------------------------------------------------------

	/**
	 * Record an orchestrator event.
	 */
	recordOrchestrator(
		outcome: PlatformAuditOutcome,
		message: string,
		detail?: Record<string, unknown>,
	): PlatformAuditEvent {
		return this.record({
			category: "orchestrator",
			severity: outcome === "failed" ? "error" : "info",
			outcome,
			timestamp: new Date().toISOString(),
			actor: "orchestrator",
			target: "orchestrator_daemon",
			message,
			detail,
		});
	}

	/**
	 * Record a plan intake event.
	 */
	recordPlanIntake(
		outcome: PlatformAuditOutcome,
		analysis: PlanIntakeAnalysis,
		actor: string = "plan_intake_optimizer",
	): PlatformAuditEvent {
		return this.record({
			category: "plan_intake",
			severity: analysis.status === "rejected" ? "warning" : "info",
			outcome,
			timestamp: new Date().toISOString(),
			actor,
			target: `plan_${analysis.queue.phase}`,
			phase: analysis.queue.phase,
			message: `Plan intake analysis for phase "${analysis.queue.phase}": ${analysis.diagnostics.length} diagnostic(s), ${analysis.bottlenecks.length} bottleneck(s), ${analysis.optimization.proposals.length} proposal(s)`,
			detail: {
				status: analysis.status,
				batchCount: analysis.batchPlan.totalBatches,
				parallelism: analysis.batchPlan.effectiveParallelism,
				proposalCount: analysis.optimization.proposals.length,
				bottleneckCount: analysis.bottlenecks.length,
				diagnosticCount: analysis.diagnostics.length,
				executionBlocked: analysis.executionBlocked,
			},
		});
	}

	/**
	 * Record an optimizer event.
	 */
	recordOptimizer(
		outcome: PlatformAuditOutcome,
		message: string,
		detail?: Record<string, unknown>,
	): PlatformAuditEvent {
		return this.record({
			category: "optimizer",
			severity: outcome === "failed" ? "error" : outcome === "denied" ? "warning" : "info",
			outcome,
			timestamp: new Date().toISOString(),
			actor: "dag_optimizer",
			target: "plan_graph",
			message,
			detail,
		});
	}

	/**
	 * Record an extension lifecycle event.
	 */
	recordExtension(
		action: string,
		extensionName: string,
		outcome: PlatformAuditOutcome,
		detail?: Record<string, unknown>,
	): PlatformAuditEvent {
		return this.record({
			category: "extension",
			severity: outcome === "denied" || outcome === "failed" ? "warning" : "info",
			outcome,
			timestamp: new Date().toISOString(),
			actor: "extension_manager",
			target: extensionName,
			message: `Extension "${extensionName}" ${action}: ${outcome}`,
			detail: { action, ...detail },
		});
	}

	/**
	 * Record a skill lifecycle event.
	 */
	recordSkill(
		action: string,
		skillName: string,
		outcome: PlatformAuditOutcome,
		detail?: Record<string, unknown>,
	): PlatformAuditEvent {
		return this.record({
			category: "skill",
			severity: outcome === "denied" || outcome === "failed" ? "warning" : "info",
			outcome,
			timestamp: new Date().toISOString(),
			actor: "skill_manager",
			target: skillName,
			message: `Skill "${skillName}" ${action}: ${outcome}`,
			detail: { action, ...detail },
		});
	}

	/**
	 * Record a memory operation event.
	 */
	recordMemory(
		action: string,
		source: string,
		outcome: PlatformAuditOutcome,
		detail?: Record<string, unknown>,
	): PlatformAuditEvent {
		return this.record({
			category: "memory",
			severity: outcome === "failed" ? "error" : outcome === "denied" ? "warning" : "info",
			outcome,
			timestamp: new Date().toISOString(),
			actor: "memory_pipeline",
			target: source,
			message: `Memory ${action} on "${source}": ${outcome}`,
			detail: { action, ...detail },
		});
	}

	/**
	 * Record a policy decision event.
	 */
	recordPolicyDecision(
		action: string,
		target: string,
		outcome: PlatformAuditOutcome,
		detail?: Record<string, unknown>,
	): PlatformAuditEvent {
		return this.record({
			category: "policy",
			severity: outcome === "denied" ? "warning" : "info",
			outcome,
			timestamp: new Date().toISOString(),
			actor: "policy_engine",
			target,
			message: `Policy decision for "${action}" on "${target}": ${outcome}`,
			detail,
		});
	}

	/**
	 * Record a graph approval event.
	 */
	recordGraphApproval(
		record: GraphApprovalRecord,
		actor: string,
	): PlatformAuditEvent {
		return this.record({
			category: "approval",
			severity: record.status === "rejected" ? "warning" : "info",
			outcome: record.status as PlatformAuditOutcome,
			timestamp: new Date().toISOString(),
			actor,
			target: `graph_${record.phase}`,
			phase: record.phase,
			message: `Graph approval "${record.id}" status: ${record.status}`,
			detail: {
				approvalId: record.id,
				originalHash: record.originalGraphHash,
				approvedHash: record.approvedGraphHash,
				batchCountDelta: record.approvedMetrics.batchCountDelta,
				parallelismDelta: record.approvedMetrics.parallelismDelta,
				expectedSpeedup: record.approvedMetrics.expectedSpeedup,
			},
			approvalId: record.id,
			beforeState: record.originalGraphHash,
			afterState: record.approvedGraphHash,
		});
	}

	/**
	 * Record a self-improvement event.
	 */
	recordSelfImprovement(
		action: string,
		outcome: PlatformAuditOutcome,
		detail?: Record<string, unknown>,
	): PlatformAuditEvent {
		return this.record({
			category: "self_improvement",
			severity: "info",
			outcome,
			timestamp: new Date().toISOString(),
			actor: "self_improvement_loop",
			target: action,
			message: `Self-improvement: "${action}" — ${outcome}`,
			detail,
		});
	}

	/**
	 * Record a dashboard action event.
	 */
	recordDashboardAction(
		action: string,
		target: string,
		outcome: PlatformAuditOutcome,
		detail?: Record<string, unknown>,
	): PlatformAuditEvent {
		return this.record({
			category: "dashboard",
			severity: "info",
			outcome,
			timestamp: new Date().toISOString(),
			actor: "dashboard",
			target,
			message: `Dashboard action: "${action}" on "${target}" — ${outcome}`,
			detail,
		});
	}
}

// ---------------------------------------------------------------------------
// Global singleton instance
// ---------------------------------------------------------------------------

let globalLedger: PlatformAuditLedger | null = null;

/**
 * Get the global platform audit ledger instance.
 *
 * Creates one if it doesn't exist.
 */
export function getPlatformAuditLedger(): PlatformAuditLedger {
	if (!globalLedger) {
		globalLedger = new PlatformAuditLedger();
	}
	return globalLedger;
}

/**
 * Reset the global platform audit ledger (for testing).
 */
export function resetPlatformAuditLedger(): void {
	globalLedger = null;
}

/**
 * Worker Triage Router — 25.O
 *
 * Reads the handoff inbox and routes each entry to the appropriate
 * worker based on target role, priority, and capability matching.
 *
 * The triage router operates autonomously with budget, cooldown,
 * dedup, and stop-condition handling. All failures surface
 * evidence-backed diagnostics rather than silent errors.
 *
 * File scope: TriageRouter class, types, and helpers.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { createWorkerDiagnostic, type WorkerDiagnostic } from "../types.js";
import type { HandoffEntry, HandoffInbox, HandoffPriority } from "./handoff-inbox.js";

// ---------------------------------------------------------------------------
// Router Status
// ---------------------------------------------------------------------------

/**
 * Operational status of the triage router.
 */
export type TriageRouterStatus = "idle" | "processing" | "cooling" | "paused" | "failed";

/**
 * All valid TriageRouterStatus values.
 */
export const ALL_TRIAGE_ROUTER_STATUSES: readonly TriageRouterStatus[] = [
	"idle",
	"processing",
	"cooling",
	"paused",
	"failed",
] as const;

// ---------------------------------------------------------------------------
// Routing Rule
// ---------------------------------------------------------------------------

/**
 * A routing rule that maps handoff criteria to a target worker.
 *
 * Rules are evaluated in order. The first matching rule determines
 * the target worker for a handoff entry.
 */
export interface RoutingRule {
	/** Unique rule ID. */
	id: string;
	/** Human-readable description of this rule. */
	description: string;
	/** Target worker role to route to (or "*" for any role match). */
	targetRole: string;
	/** Minimum priority level required for this rule to match. */
	minPriority?: HandoffPriority;
	/** Tags that must match (entry must have ALL specified tags). */
	requiredTags?: string[];
	/** Tags that must NOT be present. */
	excludedTags?: string[];
	/** The worker role to dispatch to when this rule matches. */
	dispatchToRole: string;
	/** Optional worker ID to dispatch to (overrides role-based dispatch). */
	dispatchToWorkerId?: string;
	/** Whether this rule is active. */
	enabled: boolean;
	/** Priority order (lower number = higher priority, evaluated first). */
	order: number;
}

// ---------------------------------------------------------------------------
// Router Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the TriageRouter.
 */
export interface TriageRouterConfig {
	/**
	 * Maximum entries to process per cycle.
	 * Default: 10.
	 */
	maxEntriesPerCycle: number;

	/**
	 * Cooldown period in ms between processing cycles.
	 * Default: 10_000 (10 seconds).
	 */
	cooldownMs: number;

	/**
	 * Maximum runtime in ms for a single processing cycle.
	 * Default: 30_000 (30 seconds).
	 */
	maxRuntimeMs: number;

	/**
	 * Maximum consecutive failures before the router goes into failed state.
	 * Default: 3.
	 */
	maxConsecutiveFailures: number;

	/**
	 * Whether deduplication is enabled for routing decisions.
	 * Default: true.
	 */
	enableDeduplication: boolean;

	/**
	 * Dedup window in ms for routing decisions.
	 * If the same entry was routed within this window, skip re-routing.
	 * Default: 60_000 (1 minute).
	 */
	routingDedupWindowMs: number;
}

/**
 * Default triage router configuration.
 */
export const DEFAULT_TRIAGE_ROUTER_CONFIG: TriageRouterConfig = {
	maxEntriesPerCycle: 10,
	cooldownMs: 10_000,
	maxRuntimeMs: 30_000,
	maxConsecutiveFailures: 3,
	enableDeduplication: true,
	routingDedupWindowMs: 60_000,
};

// ---------------------------------------------------------------------------
// Routing Result
// ---------------------------------------------------------------------------

/**
 * Result of routing a single handoff entry.
 */
export interface RoutingResult {
	entryId: string;
	success: boolean;
	routedToWorkerId?: string;
	routedToRole?: string;
	routingRuleId?: string;
	diagnostics: WorkerDiagnostic[];
	error?: string;
}

/**
 * Result of a full triage processing cycle.
 */
export interface TriageCycleResult {
	cycleId: string;
	startedAt: string;
	completedAt: string;
	entriesProcessed: number;
	entriesRouted: number;
	entriesSkipped: number;
	entriesFailed: number;
	routingResults: RoutingResult[];
	diagnostics: WorkerDiagnostic[];
	runtimeMs: number;
}

// ---------------------------------------------------------------------------
// Router Statistics
// ---------------------------------------------------------------------------

/**
 * Statistics for the triage router.
 */
export interface TriageRouterStats {
	status: TriageRouterStatus;
	totalCycles: number;
	totalEntriesRouted: number;
	totalEntriesFailed: number;
	totalEntriesSkipped: number;
	consecutiveFailures: number;
	lastCycleAt: string | null;
	lastCycleResult: TriageCycleResult | null;
	uptimeMs: number;
}

// ---------------------------------------------------------------------------
// TriageRouter Class
// ---------------------------------------------------------------------------

/**
 * Triage router that reads the handoff inbox and routes entries
 * to appropriate workers based on routing rules.
 *
 * Supports:
 * - Role-based and rule-based routing
 * - Priority-aware dispatch ordering
 * - Budget/cooldown/dedup/stop-condition handling
 * - Evidence-backed diagnostics on failures
 * - Configurable routing rules
 */
export class TriageRouter {
	private inbox: HandoffInbox;
	private config: TriageRouterConfig;
	private rules: RoutingRule[] = [];
	private status: TriageRouterStatus = "idle";
	private startedAt: number = Date.now();
	private totalCycles: number = 0;
	private totalEntriesRouted: number = 0;
	private totalEntriesFailed: number = 0;
	private totalEntriesSkipped: number = 0;
	private consecutiveFailures: number = 0;
	private lastCycleAt: string | null = null;
	private lastCycleResult: TriageCycleResult | null = null;
	private cooldownUntil: number = 0;
	private recentRoutings: Map<string, number> = new Map(); // entryId -> timestamp

	constructor(inbox: HandoffInbox, config: Partial<TriageRouterConfig> = {}) {
		this.inbox = inbox;
		this.config = { ...DEFAULT_TRIAGE_ROUTER_CONFIG, ...config };
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Get the current configuration.
	 */
	getConfig(): Readonly<TriageRouterConfig> {
		return { ...this.config };
	}

	/**
	 * Update the configuration.
	 */
	updateConfig(updates: Partial<TriageRouterConfig>): void {
		this.config = { ...this.config, ...updates };
	}

	/**
	 * Get the current router status.
	 */
	getStatus(): TriageRouterStatus {
		// Check if cooldown has expired
		if (this.status === "cooling" && Date.now() >= this.cooldownUntil) {
			this.status = "idle";
		}
		return this.status;
	}

	/**
	 * Get router statistics.
	 */
	getStats(): TriageRouterStats {
		return {
			status: this.getStatus(),
			totalCycles: this.totalCycles,
			totalEntriesRouted: this.totalEntriesRouted,
			totalEntriesFailed: this.totalEntriesFailed,
			totalEntriesSkipped: this.totalEntriesSkipped,
			consecutiveFailures: this.consecutiveFailures,
			lastCycleAt: this.lastCycleAt,
			lastCycleResult: this.lastCycleResult,
			uptimeMs: Date.now() - this.startedAt,
		};
	}

	// -----------------------------------------------------------------------
	// Routing Rules
	// -----------------------------------------------------------------------

	/**
	 * Get all registered routing rules, sorted by order.
	 */
	getRules(): RoutingRule[] {
		return [...this.rules].sort((a, b) => a.order - b.order);
	}

	/**
	 * Add a routing rule.
	 */
	addRule(rule: RoutingRule): void {
		// Remove existing rule with same ID if present
		this.rules = this.rules.filter((r) => r.id !== rule.id);
		this.rules.push(rule);
	}

	/**
	 * Remove a routing rule by ID.
	 * Returns true if the rule was removed.
	 */
	removeRule(ruleId: string): boolean {
		const before = this.rules.length;
		this.rules = this.rules.filter((r) => r.id !== ruleId);
		return this.rules.length < before;
	}

	/**
	 * Enable or disable a routing rule.
	 */
	setRuleEnabled(ruleId: string, enabled: boolean): boolean {
		const rule = this.rules.find((r) => r.id === ruleId);
		if (!rule) return false;
		rule.enabled = enabled;
		return true;
	}

	// -----------------------------------------------------------------------
	// Router Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Pause the triage router. No processing cycles will run until resumed.
	 */
	pause(_reason?: string): void {
		this.status = "paused";
	}

	/**
	 * Resume the triage router.
	 */
	resume(): void {
		if (this.status === "paused") {
			this.status = "idle";
		}
	}

	/**
	 * Reset the router to idle state with fresh statistics.
	 */
	reset(): void {
		this.status = "idle";
		this.totalCycles = 0;
		this.totalEntriesRouted = 0;
		this.totalEntriesFailed = 0;
		this.totalEntriesSkipped = 0;
		this.consecutiveFailures = 0;
		this.lastCycleAt = null;
		this.lastCycleResult = null;
		this.cooldownUntil = 0;
		this.recentRoutings.clear();
		this.startedAt = Date.now();
	}

	// -----------------------------------------------------------------------
	// Processing Cycle
	// -----------------------------------------------------------------------

	/**
	 * Run one processing cycle of the triage router.
	 *
	 * Reads pending entries from the inbox, applies routing rules,
	 * updates entry statuses, and returns the cycle result.
	 *
	 * Respects cooldown, max entries per cycle, and stop conditions.
	 * All failures surface evidence-backed diagnostics.
	 */
	processCycle(): TriageCycleResult {
		const cycleId = randomUUID();
		const cycleStart = Date.now();
		const diagnostics: WorkerDiagnostic[] = [];

		// Check if router is paused
		if (this.status === "paused") {
			const diag = createWorkerDiagnostic(
				"policy_blocked",
				"Triage router is paused. No processing cycle will run.",
				{ status: this.status },
			);
			return {
				cycleId,
				startedAt: new Date(cycleStart).toISOString(),
				completedAt: new Date().toISOString(),
				entriesProcessed: 0,
				entriesRouted: 0,
				entriesSkipped: 0,
				entriesFailed: 0,
				routingResults: [],
				diagnostics: [diag],
				runtimeMs: 0,
			};
		}

		// Check if in cooldown
		if (this.status === "cooling") {
			if (Date.now() < this.cooldownUntil) {
				const remaining = this.cooldownUntil - Date.now();
				const diag = createWorkerDiagnostic(
					"policy_blocked",
					`Triage router is in cooldown for ${remaining}ms more`,
					{ cooldownRemainingMs: remaining, cooldownUntil: this.cooldownUntil },
				);
				return {
					cycleId,
					startedAt: new Date(cycleStart).toISOString(),
					completedAt: new Date().toISOString(),
					entriesProcessed: 0,
					entriesRouted: 0,
					entriesSkipped: 0,
					entriesFailed: 0,
					routingResults: [],
					diagnostics: [diag],
					runtimeMs: 0,
				};
			}
			this.status = "idle";
		}

		// Check consecutive failures
		if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
			this.status = "failed";
			const diag = createWorkerDiagnostic(
				"consecutive_failures_exceeded",
				`Triage router has ${this.consecutiveFailures} consecutive failures, exceeding max of ${this.config.maxConsecutiveFailures}`,
				{
					consecutiveFailures: this.consecutiveFailures,
					maxConsecutiveFailures: this.config.maxConsecutiveFailures,
				},
			);
			return {
				cycleId,
				startedAt: new Date(cycleStart).toISOString(),
				completedAt: new Date().toISOString(),
				entriesProcessed: 0,
				entriesRouted: 0,
				entriesSkipped: 0,
				entriesFailed: 0,
				routingResults: [],
				diagnostics: [diag],
				runtimeMs: 0,
			};
		}

		this.status = "processing";
		this.totalCycles++;

		const routingResults: RoutingResult[] = [];
		let entriesRouted = 0;
		let entriesSkipped = 0;
		let entriesFailed = 0;

		try {
			// Get pending entries, sorted by priority and age
			const pending = this.inbox.list({
				status: "pending",
				sortBy: "priority",
				sortDir: "desc",
				limit: this.config.maxEntriesPerCycle,
			});

			for (const entry of pending) {
				// Check runtime budget
				const elapsed = Date.now() - cycleStart;
				if (elapsed >= this.config.maxRuntimeMs) {
					const diag = createWorkerDiagnostic(
						"timeout",
						`Triage cycle exceeded maxRuntimeMs (${this.config.maxRuntimeMs}ms) after processing ${routingResults.length} entries`,
						{
							runtimeMs: elapsed,
							maxRuntimeMs: this.config.maxRuntimeMs,
							entriesProcessed: routingResults.length,
						},
					);
					diagnostics.push(diag);
					break;
				}

				const result = this.routeEntry(entry);
				routingResults.push(result);

				if (result.success) {
					entriesRouted++;
				} else if (result.error?.includes("Skipped")) {
					entriesSkipped++;
				} else {
					entriesFailed++;
				}
			}

			// Update cumulative stats
			this.totalEntriesRouted += entriesRouted;
			this.totalEntriesFailed += entriesFailed;
			this.totalEntriesSkipped += entriesSkipped;

			// Handle consecutive failures
			const cycleFailed = entriesFailed > 0 && entriesRouted === 0;
			if (cycleFailed) {
				this.consecutiveFailures++;
			} else {
				this.consecutiveFailures = 0;
			}

			// Enter cooldown
			this.cooldownUntil = Date.now() + this.config.cooldownMs;
			this.status = "cooling";
			this.lastCycleAt = new Date().toISOString();
		} catch (error) {
			const diag = createWorkerDiagnostic("unknown_error", `Triage cycle failed with exception: ${String(error)}`, {
				error: String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
			diagnostics.push(diag);
			this.consecutiveFailures++;
			this.totalEntriesFailed += routingResults.filter((r) => !r.success).length;

			this.cooldownUntil = Date.now() + this.config.cooldownMs;
			this.status = "cooling";
			this.lastCycleAt = new Date().toISOString();
		}

		const cycleResult: TriageCycleResult = {
			cycleId,
			startedAt: new Date(cycleStart).toISOString(),
			completedAt: new Date().toISOString(),
			entriesProcessed: routingResults.length,
			entriesRouted,
			entriesSkipped,
			entriesFailed,
			routingResults,
			diagnostics,
			runtimeMs: Date.now() - cycleStart,
		};

		this.lastCycleResult = cycleResult;
		return cycleResult;
	}

	/**
	 * Route a single handoff entry.
	 *
	 * Applies routing rules to determine the target worker, updates
	 * the entry status, and records diagnostics.
	 */
	private routeEntry(entry: HandoffEntry): RoutingResult {
		const entryDiagnostics: WorkerDiagnostic[] = [];

		try {
			// Check dedup for this entry
			if (this.config.enableDeduplication) {
				const lastRouted = this.recentRoutings.get(entry.id);
				if (lastRouted && Date.now() - lastRouted < this.config.routingDedupWindowMs) {
					const diag = createWorkerDiagnostic(
						"policy_blocked",
						`Entry ${entry.id} was already routed within dedup window (${this.config.routingDedupWindowMs}ms)`,
						{
							entryId: entry.id,
							lastRoutedAt: lastRouted,
							dedupWindowMs: this.config.routingDedupWindowMs,
						},
					);
					return {
						entryId: entry.id,
						success: false,
						diagnostics: [diag],
						error: `Skipped: duplicate routing within dedup window`,
					};
				}
			}

			// Find matching rule
			const matchedRule = this.findMatchingRule(entry);

			if (!matchedRule) {
				// No rule matched — mark as failed with diagnostics
				const diag = createWorkerDiagnostic(
					"dependency_unavailable",
					`No routing rule matched for entry ${entry.id} (targetRole: ${entry.targetWorkerRole}, priority: ${entry.priority})`,
					{
						entryId: entry.id,
						targetWorkerRole: entry.targetWorkerRole,
						priority: entry.priority,
						entryTitle: entry.title,
					},
				);
				entryDiagnostics.push(diag);

				this.inbox.update(entry.id, {
					status: "failed",
					error: `No routing rule matched for target role "${entry.targetWorkerRole}"`,
					diagnostics: [diag],
				});

				return {
					entryId: entry.id,
					success: false,
					diagnostics: [diag],
					error: `No routing rule matched for target role "${entry.targetWorkerRole}"`,
				};
			}

			// Update entry to routing status
			const updateResult = this.inbox.update(entry.id, {
				status: "routing",
				targetWorkerId: matchedRule.dispatchToWorkerId,
			});

			if ("error" in updateResult) {
				const diag = createWorkerDiagnostic(
					"unknown_error",
					`Failed to update entry ${entry.id} to routing status: ${updateResult.error}`,
					{ entryId: entry.id, error: updateResult.error },
				);
				return {
					entryId: entry.id,
					success: false,
					diagnostics: [diag, ...updateResult.diagnostics],
					error: updateResult.error,
				};
			}

			// Record the routing for dedup
			this.recentRoutings.set(entry.id, Date.now());

			// Mark as dispatched
			const dispatchResult = this.inbox.update(entry.id, {
				status: "dispatched",
				metadata: {
					routedBy: "triage-router",
					routingRuleId: matchedRule.id,
					dispatchedAt: new Date().toISOString(),
				},
			});

			if ("error" in dispatchResult) {
				const diag = createWorkerDiagnostic(
					"unknown_error",
					`Failed to mark entry ${entry.id} as dispatched: ${dispatchResult.error}`,
					{ entryId: entry.id, error: dispatchResult.error },
				);
				return {
					entryId: entry.id,
					success: false,
					diagnostics: [diag, ...dispatchResult.diagnostics],
					error: dispatchResult.error,
				};
			}

			const successDiag = createWorkerDiagnostic(
				"completed",
				`Entry ${entry.id} routed to role "${matchedRule.dispatchToRole}" via rule "${matchedRule.description}"`,
				{
					entryId: entry.id,
					routingRuleId: matchedRule.id,
					dispatchToRole: matchedRule.dispatchToRole,
					dispatchToWorkerId: matchedRule.dispatchToWorkerId,
				},
			);

			return {
				entryId: entry.id,
				success: true,
				routedToWorkerId: matchedRule.dispatchToWorkerId,
				routedToRole: matchedRule.dispatchToRole,
				routingRuleId: matchedRule.id,
				diagnostics: [successDiag],
			};
		} catch (error) {
			const diag = createWorkerDiagnostic(
				"unknown_error",
				`Exception while routing entry ${entry.id}: ${String(error)}`,
				{
					entryId: entry.id,
					error: String(error),
					stack: error instanceof Error ? error.stack : undefined,
				},
			);

			// Try to mark as failed in inbox
			try {
				this.inbox.update(entry.id, {
					status: "failed",
					error: String(error),
					diagnostics: [diag],
				});
			} catch {
				// Best-effort
			}

			return {
				entryId: entry.id,
				success: false,
				diagnostics: [diag],
				error: String(error),
			};
		}
	}

	/**
	 * Find the first matching routing rule for a handoff entry.
	 *
	 * Rules are evaluated in order (by `order` field, ascending).
	 * The first rule that matches returns. If no rule matches, returns undefined.
	 */
	private findMatchingRule(entry: HandoffEntry): RoutingRule | undefined {
		const sortedRules = [...this.rules].filter((r) => r.enabled).sort((a, b) => a.order - b.order);

		for (const rule of sortedRules) {
			// Check role match (rule.targetRole can be "*" to match any)
			if (rule.targetRole !== "*" && rule.targetRole !== entry.targetWorkerRole) {
				continue;
			}

			// Check minimum priority
			if (rule.minPriority) {
				const priorityOrder: Record<HandoffPriority, number> = {
					low: 0,
					normal: 1,
					high: 2,
					critical: 3,
				};
				if (priorityOrder[entry.priority] < priorityOrder[rule.minPriority]) {
					continue;
				}
			}

			// Check required tags (entry must have ALL specified tags)
			if (rule.requiredTags && rule.requiredTags.length > 0) {
				const hasAll = rule.requiredTags.every((tag) => entry.tags.includes(tag));
				if (!hasAll) continue;
			}

			// Check excluded tags (entry must NOT have any of these)
			if (rule.excludedTags && rule.excludedTags.length > 0) {
				const hasExcluded = rule.excludedTags.some((tag) => entry.tags.includes(tag));
				if (hasExcluded) continue;
			}

			return rule;
		}

		return undefined;
	}
}

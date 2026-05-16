/**
 * Mutation Guard - P11.B
 *
 * Blocks mutation attempts from unauthorised components and logs them
 * as policy events. The orchestrator must never mutate code, queue state,
 * protected systems, or execution graphs directly.
 *
 * Every blocked mutation is recorded with category, target, source, and
 * severity for audit trail and dashboard visibility.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { AuditLevel, PlatformComponent } from "../platform/types.js";
import { PiLogger } from "../utils/logger.js";
import type {
	MutationCategory,
	MutationGuardSnapshot,
	PolicyEvent,
} from "./orchestrator-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of recent policy events retained in memory. */
const MAX_RECENT_EVENTS = 50;

/** Default source component when not specified. */
const DEFAULT_SOURCE = PlatformComponent.CodingAgent;

/**
 * Path patterns considered "protected systems" — mutations to these
 * are always blocked with critical severity.
 */
const PROTECTED_PATH_PATTERNS: RegExp[] = [
	/\.pi\/(settings|agent|skills)\//,
	/packages\/(agent|ai|tui)\/src\//,
	/node_modules\//,
];

// ---------------------------------------------------------------------------
// MutationGuard
// ---------------------------------------------------------------------------

/**
 * Mutation guard that intercepts and blocks mutation attempts.
 *
 * The guard categorises each attempt and logs it as a policy event.
 * It never allows mutations — it only records them for audit.
 *
 * AC4: Mutation attempts are blocked and logged as policy events.
 */
export class MutationGuard {
	private _events: PolicyEvent[] = [];
	private _byCategory = new Map<MutationCategory, number>();
	private readonly _log: PiLogger;

	constructor(context?: Record<string, unknown>) {
		this._log = new PiLogger({ component: "mutation-guard", ...context });
	}

	// -----------------------------------------------------------------------
	// Accessors
	// -----------------------------------------------------------------------

	/** Total blocked mutations. */
	get totalBlocked(): number {
		return this._events.length;
	}

	/** Whether blocking is active (always true for the orchestrator). */
	get blockingActive(): boolean {
		return true;
	}

	/** Recent policy events (immutable view, newest first). */
	get recentEvents(): ReadonlyArray<PolicyEvent> {
		return this._events;
	}

	// -----------------------------------------------------------------------
	// Blocking
	// -----------------------------------------------------------------------

	/**
	 * Record and log a blocked mutation attempt.
	 *
	 * @param category - Category of the blocked mutation
	 * @param attempt - Description of what was attempted
	 * @param target - Target path or resource
	 * @param options - Additional options
	 * @returns The created policy event
	 */
	block(
		category: MutationCategory,
		attempt: string,
		target: string,
		options?: {
			source?: string;
			severity?: AuditLevel;
			detail?: string;
		},
	): PolicyEvent {
		const source = options?.source ?? DEFAULT_SOURCE;
		const severity = options?.severity ?? this.resolveSeverity(category, target);

		const event: PolicyEvent = {
			id: `policy-${randomUUID()}`,
			timestamp: new Date().toISOString(),
			category,
			attempt,
			target,
			source,
			severity,
			detail: options?.detail ?? `Blocked ${category} mutation at ${target}`,
		};

		// Record event
		this._events.unshift(event);
		if (this._events.length > MAX_RECENT_EVENTS) {
			this._events.pop();
		}

		// Update category counts
		this._byCategory.set(category, (this._byCategory.get(category) ?? 0) + 1);

		// Log the policy event
		const logLevel = severity === AuditLevel.Critical ? "error" : severity === AuditLevel.Warn ? "warn" : "info";
		this._log[logLevel](`POLICY EVENT [${category}] ${attempt} -> ${target}`, {
			eventId: event.id,
			severity,
			source,
		});

		return event;
	}

	/**
	 * Check if a path is protected (matches protected system patterns).
	 *
	 * @param path - Path to check
	 * @returns True if the path is protected
	 */
	isProtectedPath(path: string): boolean {
		return PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(path));
	}

	/**
	 * Attempt a mutation — always blocked and logged.
	 * This is the primary API that the orchestrator calls before any mutation.
	 *
	 * @param category - Category of the attempted mutation
	 * @param attempt - Description of what was attempted
	 * @param target - Target path or resource
	 * @param options - Additional options
	 * @returns Always returns false (mutation blocked)
	 */
	tryMutate(
		category: MutationCategory,
		attempt: string,
		target: string,
		options?: {
			source?: string;
			severity?: AuditLevel;
			detail?: string;
		},
	): boolean {
		this.block(category, attempt, target, options);
		return false; // Always blocked
	}

	/**
	 * Classify a path into a mutation category.
	 *
	 * @param path - Target path to classify
	 * @returns The most specific mutation category
	 */
	classifyPath(path: string): MutationCategory {
		if (this.isProtectedPath(path)) {
			return "protected_system";
		}
		if (/\.(ts|js|tsx|jsx|json|md|css|html)$/i.test(path)) {
			return "code_write";
		}
		if (/\/queue\//.test(path) || /queue\.json$/.test(path)) {
			return "queue_mutate";
		}
		if (/\.pi\//.test(path)) {
			return "state_mutate";
		}
		if (/dependency|dag|graph|batch/i.test(path)) {
			return "execution_graph";
		}
		return "code_write";
	}

	// -----------------------------------------------------------------------
	// Snapshot
	// -----------------------------------------------------------------------

	/**
	 * Get a snapshot of the mutation guard state.
	 */
	snapshot(): MutationGuardSnapshot {
		const byCategory: Record<string, number> = {};
		for (const [cat, count] of this._byCategory) {
			byCategory[cat] = count;
		}

		return {
			totalBlocked: this.totalBlocked,
			byCategory: byCategory as Record<MutationCategory, number>,
			recentEvents: this._events.slice(0, MAX_RECENT_EVENTS),
			blockingActive: this.blockingActive,
		};
	}

	/**
	 * Clear all recorded events (for testing / reset).
	 */
	clear(): void {
		this._events = [];
		this._byCategory.clear();
	}

	// -----------------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------------

	/**
	 * Resolve the severity level for a blocked mutation.
	 * Protected system mutations are always critical.
	 */
	private resolveSeverity(category: MutationCategory, target: string): AuditLevel {
		if (this.isProtectedPath(target) || category === "protected_system") {
			return AuditLevel.Critical;
		}
		if (category === "execution_graph" || category === "queue_mutate" || category === "state_mutate") {
			return AuditLevel.Error;
		}
		return AuditLevel.Warn;
	}
}

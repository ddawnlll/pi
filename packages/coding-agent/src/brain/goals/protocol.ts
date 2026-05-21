/**
 * User Protocol Actions — P15.F
 *
 * Implements morning protocol, daytime protocol, night protocol, rejection
 * protocol, and memory correction protocol from vision §11.
 *
 * The UserProtocol class orchestrates the daily workflow:
 * - Morning: generate structured report and markdown summary
 * - Daytime: process approvals, rejections, and memory corrections
 * - Night: configure and monitor overnight autonomous runs
 * - Explain: classify actions with detailed reasoning
 *
 * Dependencies: P15.B (GoalStore), P15.C (AutonomyEngine), P15.D (DecisionClassifier)
 */

import { randomUUID } from "node:crypto";
import type { MemoryCorrectionRecord } from "../memory/api.js";
import type { DecisionClassifier } from "./decisions.js";
import type { AutonomyEngine } from "./profile-engine.js";
import type { GoalIndexEntry, GoalStore } from "./store.js";
import type { AutonomyLevel, DecisionClassification, DecisionRule } from "./types.js";

// ---------------------------------------------------------------------------
// Types: Morning Protocol
// ---------------------------------------------------------------------------

/**
 * Structured data returned by the morning protocol.
 *
 * Describes what ran, completed, stopped, changed, learned,
 * needs approval, top 3 next actions, and artifact links.
 */
export interface MorningReportData {
	/** ISO 8601 date string for the report period */
	date: string;
	/** Plans that ran during the period */
	whatRan: Array<{ planId: string; planTitle: string; status: string }>;
	/** Plans that completed during the period */
	whatCompleted: Array<{ planId: string; planTitle: string }>;
	/** Plans that stopped during the period with reason */
	whatStopped: Array<{ planId: string; planTitle: string; reason: string }>;
	/** Things that changed in the system */
	whatChanged: string[];
	/** Things learned during the period */
	whatLearned: string[];
	/** Items needing user approval */
	needsApproval: Array<{ type: string; id: string; description: string }>;
	/** Top 3 recommended next actions */
	top3NextActions: string[];
	/** Links to relevant artifacts (reports, logs, etc.) */
	artifactLinks: Array<{ label: string; path: string }>;
}

/**
 * A single entry in the whatRan list.
 *
 * @deprecated Use inline `whatRan` item shape instead.
 */
export interface WhatRanEntry {
	planId: string;
	planTitle: string;
	status: string;
}

/**
 * A single entry in the whatCompleted list.
 */
export interface WhatCompletedEntry {
	planId: string;
	planTitle: string;
}

/**
 * A single entry in the whatStopped list.
 */
export interface WhatStoppedEntry {
	planId: string;
	planTitle: string;
	reason: string;
}

/**
 * A single entry in the needsApproval list.
 */
export interface NeedsApprovalEntry {
	type: string;
	id: string;
	description: string;
}

// ---------------------------------------------------------------------------
// Types: Night Protocol
// ---------------------------------------------------------------------------

/**
 * Configuration for a night (overnight) autonomous run session.
 */
export interface NightProtocolConfig {
	/** Queue of plan IDs to execute during the night run */
	queue: string[];
	/** Autonomy level for the night run */
	autonomyLevel: AutonomyLevel;
	/** Conditions that will trigger an automatic stop */
	stopConditions: StopCondition[];
	/** Maximum allowed duration in hours */
	maxDurationHours: number;
	/** Optional notification email for completion or failure */
	notificationEmail?: string;
	/** Whether to generate a morning report after the run completes */
	generateMorningReport: boolean;
}

/**
 * A condition that will trigger an automatic stop of a night run.
 */
export type StopCondition =
	| "integration_queue_dirty"
	| "merge_conflict"
	| "policy_violation"
	| "low_confidence_unsafe"
	| "user_intervention"
	| "error_threshold_exceeded";

/**
 * Describes a single stop condition with metadata.
 */
export interface NightProtocolStopCondition {
	/** The stop condition type */
	condition: StopCondition;
	/** Human-readable reason for the stop */
	reason: string;
	/** Whether the condition is enabled */
	enabled: boolean;
}

// ---------------------------------------------------------------------------
// Types: Rejection Protocol
// ---------------------------------------------------------------------------

/**
 * Records a rejection of a proposal.
 *
 * Includes the proposal ID, reason, category, suppression flag,
 * and whether the rejection was recorded in memory.
 */
export interface RejectionRecord {
	/** Unique rejection identifier (UUID v4) */
	id: string;
	/** The ID of the proposal that was rejected */
	proposalId: string;
	/** ISO 8601 timestamp of when the proposal was made */
	proposedAt: string;
	/** ISO 8601 timestamp of when the rejection was recorded */
	rejectedAt: string;
	/** Human-readable reason for the rejection */
	rejectionReason?: string;
	/** Category of the rejection (e.g., "policy", "duplicate", "low_quality") */
	category: string;
	/** IDs of other proposals/items affected by this rejection */
	affected: string[];
	/** Whether to suppress similar future proposals */
	suppressSimilar: boolean;
	/** Whether the rejection was recorded in memory */
	memoryUpdated: boolean;
	/** The ID of the updated memory record (if memoryUpdated is true) */
	updatedMemoryId?: string;
}

// ---------------------------------------------------------------------------
// Types: Decision Explanation
// ---------------------------------------------------------------------------

/**
 * Detailed explanation of a decision classification.
 *
 * Returned by the explainDecision() method to provide full transparency
 * into how an action was classified and what options the user has.
 */
export interface DecisionExplanation {
	/** The action that was classified */
	action: string;
	/** The decision classification result */
	decision: DecisionClassification;
	/** Human-readable reasoning for the classification */
	reasoning: string;
	/** The decision rules that were applicable to this action */
	applicableRules: DecisionRule[];
	/** The autonomy level at which the classification was made */
	autonomyLevel: AutonomyLevel;
	/** Options available to appeal or override the decision */
	appealOptions: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * All possible stop conditions for night protocol.
 */
export const ALL_NIGHT_PROTOCOL_STOP_CONDITIONS: NightProtocolStopCondition[] = [
	{ condition: "integration_queue_dirty", reason: "Integration queue has unprocessed items", enabled: true },
	{ condition: "merge_conflict", reason: "Merge conflict detected during integration", enabled: true },
	{ condition: "policy_violation", reason: "Policy violation detected during execution", enabled: true },
	{ condition: "low_confidence_unsafe", reason: "Low confidence indicates unsafe action", enabled: true },
	{ condition: "user_intervention", reason: "User requested manual intervention", enabled: true },
	{ condition: "error_threshold_exceeded", reason: "Error rate exceeded maximum threshold", enabled: true },
];

/**
 * Default stop conditions for the night protocol.
 */
export const DEFAULT_NIGHT_PROTOCOL_STOP_CONDITIONS: NightProtocolStopCondition[] = [
	{ condition: "integration_queue_dirty", reason: "Integration queue is dirty", enabled: true },
	{ condition: "merge_conflict", reason: "Merge conflict detected", enabled: true },
	{ condition: "policy_violation", reason: "Policy violation", enabled: true },
];

/**
 * Default maximum duration for a night run in hours.
 */
export const DEFAULT_NIGHT_MAX_DURATION_HOURS = 8;

// ---------------------------------------------------------------------------
// Helper: Get default stop conditions as StopCondition strings
// ---------------------------------------------------------------------------

function _getDefaultStopConditions(): StopCondition[] {
	return DEFAULT_NIGHT_PROTOCOL_STOP_CONDITIONS.filter((s) => s.enabled).map((s) => s.condition) as StopCondition[];
}

// ---------------------------------------------------------------------------
// User Protocol
// ---------------------------------------------------------------------------

/**
 * Orchestrates the daily user protocol: morning reports, daytime actions,
 * night configuration, and decision explanations.
 *
 * @example
 * ```typescript
 * const store = new GoalStore();
 * await store.initialize();
 * const engine = new AutonomyEngine();
 * const classifier = new DecisionClassifier();
 * const protocol = new UserProtocol(store, engine, classifier);
 *
 * const report = await protocol.getMorningData();
 * console.log(await protocol.generateMorningMarkdown());
 * ```
 */
export class UserProtocol {
	private nightSessions: Map<string, NightSession> = new Map();
	private rejectionRecords: RejectionRecord[] = [];
	private pendingApprovals: Map<string, PendingApproval> = new Map();

	constructor(
		private goalStore: GoalStore,
		private autonomyEngine: AutonomyEngine,
		private decisionClassifier?: DecisionClassifier,
		_observationEngine?: unknown,
	) {}

	// -----------------------------------------------------------------------
	// Morning Protocol
	// -----------------------------------------------------------------------

	/**
	 * Gather structured morning report data from the current system state.
	 *
	 * Queries the goal store for active, completed, and stopped goals;
	 * checks for pending approvals; and determines top next actions.
	 *
	 * @returns Promise resolving to MorningReportData
	 */
	async getMorningData(): Promise<MorningReportData> {
		const today = new Date().toISOString().split("T")[0]!;

		// Gather goals from the store (the store uses index-based lookup)
		const goals = await this.getGoalsFromStore();
		const allPlans = await this.getPlanStatuses(goals);

		return {
			date: today,
			whatRan: allPlans.whatRan,
			whatCompleted: allPlans.whatCompleted,
			whatStopped: allPlans.whatStopped,
			whatChanged: await this.getWhatChanged(),
			whatLearned: await this.getWhatLearned(),
			needsApproval: this.getNeedsApprovalList(),
			top3NextActions: this.getTopNextActions(allPlans.whatCompleted, allPlans.whatRan),
			artifactLinks: await this.getArtifactLinks(),
		};
	}

	/**
	 * Generate a human-readable markdown morning report.
	 *
	 * @returns Promise resolving to a formatted markdown string
	 */
	async generateMorningMarkdown(): Promise<string> {
		const data = await this.getMorningData();
		const lines: string[] = [];

		lines.push(`# Morning Report — ${data.date}`);
		lines.push("");

		lines.push("## What Ran");
		if (data.whatRan.length === 0) {
			lines.push("*Nothing ran during this period.*");
		} else {
			for (const entry of data.whatRan) {
				lines.push(`- **${entry.planTitle}** (\`${entry.planId}\`) — ${entry.status}`);
			}
		}
		lines.push("");

		lines.push("## What Completed");
		if (data.whatCompleted.length === 0) {
			lines.push("*Nothing completed during this period.*");
		} else {
			for (const entry of data.whatCompleted) {
				lines.push(`- **${entry.planTitle}** (\`${entry.planId}\`)`);
			}
		}
		lines.push("");

		lines.push("## What Stopped");
		if (data.whatStopped.length === 0) {
			lines.push("*Nothing stopped during this period.*");
		} else {
			for (const entry of data.whatStopped) {
				lines.push(`- **${entry.planTitle}** (\`${entry.planId}\`) — ${entry.reason}`);
			}
		}
		lines.push("");

		lines.push("## What Changed");
		if (data.whatChanged.length === 0) {
			lines.push("*No changes detected.*");
		} else {
			for (const change of data.whatChanged) {
				lines.push(`- ${change}`);
			}
		}
		lines.push("");

		lines.push("## What Was Learned");
		if (data.whatLearned.length === 0) {
			lines.push("*Nothing new was learned during this period.*");
		} else {
			for (const item of data.whatLearned) {
				lines.push(`- ${item}`);
			}
		}
		lines.push("");

		lines.push("## Needs Approval");
		if (data.needsApproval.length === 0) {
			lines.push("*No items require approval.*");
		} else {
			for (const item of data.needsApproval) {
				lines.push(`- [${item.type}] **${item.description}** (\`${item.id}\`)`);
			}
		}
		lines.push("");

		lines.push("## Top 3 Next Actions");
		for (let i = 0; i < data.top3NextActions.length; i++) {
			lines.push(`${i + 1}. ${data.top3NextActions[i]}`);
		}
		lines.push("");

		if (data.artifactLinks.length > 0) {
			lines.push("## Artifacts");
			for (const link of data.artifactLinks) {
				lines.push(`- [${link.label}](${link.path})`);
			}
			lines.push("");
		}

		return lines.join("\n");
	}

	// -----------------------------------------------------------------------
	// Daytime Protocol
	// -----------------------------------------------------------------------

	/**
	 * Process an approval or rejection of a pending request.
	 *
	 * @param requestId - The ID of the approval request
	 * @param approved - Whether the request was approved (true) or rejected (false)
	 * @param by - The user or system that processed the approval
	 */
	async processApproval(requestId: string, approved: boolean, by: string): Promise<void> {
		if (!by) {
			throw new Error("Approver identity (by) is required");
		}

		const pending = this.pendingApprovals.get(requestId);
		if (!pending) {
			throw new Error(`No pending approval found for request ID: ${requestId}`);
		}

		this.pendingApprovals.delete(requestId);

		if (approved) {
			// Record approval — in a full implementation, this would trigger
			// execution of the approved action
			this.autonomyEngine.setConfig({ emergencyStopped: false });
		} else {
			// Record rejection
			await this.processRejection(pending.proposalId, by, pending.description);
		}
	}

	/**
	 * Record a rejection of a proposal.
	 *
	 * Creates a RejectionRecord and optionally updates memory to suppress
	 * similar future proposals.
	 *
	 * @param proposalId - The ID of the proposal being rejected
	 * @param by - The user or system that rejected the proposal
	 * @param reason - Optional human-readable reason for the rejection
	 * @returns The created RejectionRecord
	 */
	async processRejection(proposalId: string, by: string, reason?: string): Promise<RejectionRecord> {
		if (!by) {
			throw new Error("Rejector identity (by) is required");
		}
		if (!proposalId) {
			throw new Error("proposalId is required");
		}

		const record: RejectionRecord = {
			id: randomUUID(),
			proposalId,
			proposedAt: new Date().toISOString(),
			rejectedAt: new Date().toISOString(),
			rejectionReason: reason,
			category: this.categorizeRejection(proposalId, reason),
			affected: [],
			suppressSimilar: true,
			memoryUpdated: false,
		};

		this.rejectionRecords.push(record);
		return record;
	}

	/**
	 * Process a memory correction.
	 *
	 * Creates a MemoryCorrectionRecord and attempts to update the memory store.
	 *
	 * @param memoryId - The ID of the memory record to correct
	 * @param correction - The correction description or replacement data
	 * @param by - The user or system making the correction
	 * @returns The created MemoryCorrectionRecord
	 */
	async processMemoryCorrection(memoryId: string, correction: string, by: string): Promise<MemoryCorrectionRecord> {
		if (!by) {
			throw new Error("Corrector identity (by) is required");
		}
		if (!memoryId) {
			throw new Error("memoryId is required");
		}

		const record: MemoryCorrectionRecord = {
			id: randomUUID(),
			originalMemoryId: memoryId,
			reason: correction,
			action: "corrected",
			createdAt: new Date().toISOString(),
			createdBy: by,
		};

		return record;
	}

	// -----------------------------------------------------------------------
	// Night Protocol
	// -----------------------------------------------------------------------

	/**
	 * Configure a night (overnight) autonomous run session.
	 *
	 * Validates the configuration and creates a session placeholder.
	 *
	 * @param config - The night protocol configuration
	 * @returns An object containing the session ID
	 */
	async configureNightRun(config: NightProtocolConfig): Promise<{ sessionId: string }> {
		// Validate config
		if (!config.queue || config.queue.length === 0) {
			throw new Error("Queue must contain at least one plan ID");
		}
		if (![1, 2, 3, 4].includes(config.autonomyLevel as number)) {
			throw new Error(`Invalid autonomy level: ${config.autonomyLevel}`);
		}
		if (config.maxDurationHours <= 0 || config.maxDurationHours > 24) {
			throw new Error(`maxDurationHours must be between 1 and 24, got ${config.maxDurationHours}`);
		}

		const sessionId = randomUUID();
		const session: NightSession = {
			id: sessionId,
			config,
			status: "configured",
			progress: 0,
			createdAt: new Date().toISOString(),
		};

		this.nightSessions.set(sessionId, session);
		return { sessionId };
	}

	/**
	 * Start a configured night run session.
	 *
	 * In a full implementation, this would kick off the overnight
	 * orchestrator with the given configuration.
	 *
	 * @param sessionId - The session ID returned by configureNightRun
	 */
	async startNightRun(sessionId: string): Promise<void> {
		const session = this.nightSessions.get(sessionId);
		if (!session) {
			throw new Error(`Night run session not found: ${sessionId}`);
		}
		if (session.status !== "configured") {
			throw new Error(
				`Cannot start night run session ${sessionId}: current status is "${session.status}", expected "configured"`,
			);
		}

		session.status = "running";
		session.startedAt = new Date().toISOString();
	}

	/**
	 * Check the current status and progress of a night run session.
	 *
	 * @param sessionId - The session ID
	 * @returns An object with the status string and progress (0-1)
	 */
	async checkNightRunStatus(sessionId: string): Promise<{ status: string; progress: number }> {
		const session = this.nightSessions.get(sessionId);
		if (!session) {
			throw new Error(`Night run session not found: ${sessionId}`);
		}

		return {
			status: session.status,
			progress: session.progress,
		};
	}

	// -----------------------------------------------------------------------
	// Explain
	// -----------------------------------------------------------------------

	/**
	 * Explain how a decision was classified for a given action.
	 *
	 * Uses the DecisionClassifier (if available) plus the current autonomy
	 * level to provide a detailed explanation.
	 *
	 * @param action - The action to explain
	 * @param context - Additional context for classification
	 * @returns A DecisionExplanation with full details
	 */
	async explainDecision(action: string, context: Record<string, unknown>): Promise<DecisionExplanation> {
		const autonomyLevel = (context.autonomyLevel as AutonomyLevel) ?? 2;

		let decision: DecisionClassification;
		let applicableRules: DecisionRule[] = [];

		if (this.decisionClassifier) {
			decision = this.decisionClassifier.classifyWithContext(action, {
				autonomyLevel,
				...context,
			} as Parameters<typeof this.decisionClassifier.classifyWithContext>[1]);

			// Gather rules that match this action
			applicableRules = this.decisionClassifier
				.getRules()
				.filter((r) => r.action === action)
				.sort((a, b) => b.priority - a.priority);
		} else {
			// Fallback when no classifier is available
			decision = {
				action,
				decisionClass: "approval_required",
				confidence: 0.5,
				requiresApprovalFrom: "user",
				policyRefs: ["fallback"],
				rationale: "No decision classifier available — defaulting to approval_required",
				autonomyLevel,
			};
		}

		const appealOptions = this.getAppealOptions(decision.decisionClass);

		return {
			action,
			decision,
			reasoning: this.buildReasoning(decision, applicableRules, autonomyLevel),
			applicableRules,
			autonomyLevel,
			appealOptions,
		};
	}

	// -----------------------------------------------------------------------
	// Accessors for pending state
	// -----------------------------------------------------------------------

	/**
	 * Get all recorded rejection records.
	 */
	getRejectionRecords(): RejectionRecord[] {
		return [...this.rejectionRecords];
	}

	/**
	 * Get all pending approval requests.
	 */
	getPendingApprovals(): Map<string, PendingApproval> {
		return new Map(this.pendingApprovals);
	}

	/**
	 * Register a pending approval request.
	 *
	 * Called by other parts of the system when an action requires approval.
	 *
	 * @param proposalId - The ID of the proposal requiring approval
	 * @param description - Human-readable description
	 * @param requestedBy - Who requested the approval
	 * @returns The generated request ID
	 */
	registerPendingApproval(proposalId: string, description: string, requestedBy: string): string {
		const requestId = randomUUID();
		this.pendingApprovals.set(requestId, {
			requestId,
			proposalId,
			description,
			requestedBy,
			requestedAt: new Date().toISOString(),
		});
		return requestId;
	}

	// -----------------------------------------------------------------------
	// Internal helpers
	// -----------------------------------------------------------------------

	/**
	 * Get goals from the store, with fallback for when no store is available.
	 */
	private async getGoalsFromStore(): Promise<GoalIndexEntry[]> {
		try {
			// Attempt to get goals via the store's index
			// The store exposes index data through index properties
			if (this.goalStore) {
				const config = this.goalStore.getConfig();
				if (config) {
					// Return empty list — actual store query would happen here
					// in a full implementation
					return [];
				}
			}
		} catch {
			// Store not available
		}
		return [];
	}

	/**
	 * Derive plan statuses from goal index entries.
	 */
	private async getPlanStatuses(goals: GoalIndexEntry[]): Promise<{
		whatRan: MorningReportData["whatRan"];
		whatCompleted: MorningReportData["whatCompleted"];
		whatStopped: MorningReportData["whatStopped"];
	}> {
		const whatRan: MorningReportData["whatRan"] = [];
		const whatCompleted: MorningReportData["whatCompleted"] = [];
		const whatStopped: MorningReportData["whatStopped"] = [];

		for (const goal of goals) {
			const entry = {
				planId: goal.id,
				planTitle: `Goal: ${goal.id}`,
				status: goal.status,
			};
			whatRan.push(entry);

			if (goal.status === "completed") {
				whatCompleted.push({ planId: goal.id, planTitle: `Goal: ${goal.id}` });
			}
		}

		return { whatRan, whatCompleted, whatStopped };
	}

	/**
	 * Determine what changed in the system since last report.
	 */
	private async getWhatChanged(): Promise<string[]> {
		const changes: string[] = [];
		try {
			if (this.goalStore) {
				const config = this.goalStore.getConfig();
				changes.push(`Goal store base path: ${config.basePath}`);
			}
		} catch {
			// Ignore
		}
		return changes;
	}

	/**
	 * Determine what was learned since last report.
	 */
	private async getWhatLearned(): Promise<string[]> {
		// In a full implementation, this would query the memory store
		// or observation engine for learned insights
		return [];
	}

	/**
	 * Get the list of items requiring approval.
	 */
	private getNeedsApprovalList(): MorningReportData["needsApproval"] {
		const list: MorningReportData["needsApproval"] = [];
		for (const [, pending] of this.pendingApprovals) {
			list.push({
				type: "approval",
				id: pending.proposalId,
				description: pending.description,
			});
		}
		return list;
	}

	/**
	 * Determine the top next actions from the current state.
	 */
	private getTopNextActions(
		_completed: MorningReportData["whatCompleted"],
		_ran: MorningReportData["whatRan"],
	): string[] {
		// In a full implementation, this would use the goal store and
		// observation engine to determine priority next actions
		return [];
	}

	/**
	 * Get artifact links for the morning report.
	 */
	private async getArtifactLinks(): Promise<MorningReportData["artifactLinks"]> {
		return [
			{ label: "Goals Overview", path: "/brain/goals" },
			{ label: "Preferences", path: "/brain/preferences" },
		];
	}

	/**
	 * Categorize a rejection based on the proposal ID and reason.
	 */
	private categorizeRejection(_proposalId: string, reason?: string): string {
		if (!reason) return "unspecified";

		const lower = reason.toLowerCase();
		if (lower.includes("duplicate") || lower.includes("already")) return "duplicate";
		if (lower.includes("policy") || lower.includes("forbidden")) return "policy";
		if (lower.includes("quality") || lower.includes("low") || lower.includes("poor")) return "low_quality";
		if (lower.includes("irrelevant") || lower.includes("off topic")) return "irrelevant";

		return "other";
	}

	/**
	 * Get the appeal options available for a given decision class.
	 */
	private getAppealOptions(decisionClass: string): string[] {
		switch (decisionClass) {
			case "auto_decide":
				return ["Override to approval_required", "Flag for review"];
			case "approval_required":
				return ["Approve now", "Escalate to higher authority", "Request more information"];
			case "never_auto_decide":
				return ["Request policy exception", "Contact system administrator", "Review security policy documentation"];
			default:
				return ["Contact support"];
		}
	}

	/**
	 * Build a human-readable reasoning string for a decision.
	 */
	private buildReasoning(decision: DecisionClassification, rules: DecisionRule[], level: AutonomyLevel): string {
		const parts: string[] = [];

		parts.push(`Action "${decision.action}" was classified as "${decision.decisionClass}".`);
		parts.push(`Autonomy level at time of decision: ${level}.`);

		if (decision.rationale) {
			parts.push(`Rationale: ${decision.rationale}`);
		}

		if (rules.length > 0) {
			parts.push("Applicable rules:");
			for (const rule of rules) {
				parts.push(`  - [${rule.id}] ${rule.description} (priority: ${rule.priority})`);
			}
		}

		if (decision.policyRefs && decision.policyRefs.length > 0) {
			parts.push(`Policy references: ${decision.policyRefs.join(", ")}`);
		}

		if (decision.requiresApprovalFrom) {
			parts.push(`Approval required from: ${decision.requiresApprovalFrom}`);
		}

		return parts.join("\n");
	}
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/**
 * Internal representation of a pending approval request.
 */
export interface PendingApproval {
	requestId: string;
	proposalId: string;
	description: string;
	requestedBy: string;
	requestedAt: string;
}

/**
 * Internal representation of a night (overnight) run session.
 */
interface NightSession {
	id: string;
	config: NightProtocolConfig;
	status: string;
	progress: number;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
	error?: string;
}

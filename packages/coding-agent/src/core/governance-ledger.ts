/**
 * Governance Ledger - P9.G7
 *
 * Central audit trail that wires together all G1-G6 components into a
 * single coherent ledger. Every governance-relevant event across the
 * remediation lifecycle is recorded here, providing an immutable record
 * for audit, compliance, and post-mortem analysis.
 *
 * G1-G6 Component Events:
 *   G1 (Remediation Runtime) — State transitions, scan events
 *   G2 (Proposal/Execution DB) — Proposal submissions, execution records,
 *        revision history
 *   G3 (Approval & Budget) — Approval events, change requests,
 *        self-modification approvals, budget snapshots, approval chains
 *   G4 (Dry-Run & Validation) — Dry-run assumptions, validation outcomes,
 *        validation failures
 *   G5 (Budget Enforcer / Policy Engine) — Budget summaries, policy checks,
 *        autonomy classifications, blast-radius controls
 *   G6 (Safety Doctor / Execution Simulator / Integration Queue) —
 *        Safety reports, simulation forecasts, queue audit entries
 *
 * The completion gate (P4.6.1) requires a complete ledger entry before
 * marking any workspace or plan done.
 */

// ---------------------------------------------------------------------------
// Source Identifiers
// ---------------------------------------------------------------------------

/**
 * Known component sources that write to the governance ledger.
 */
export type LedgerSource =
	| "g1_remediation_runtime"
	| "g2_proposal_db"
	| "g3_approval_budget"
	| "g4_dry_run_validation"
	| "g5_budget_policy_engine"
	| "g6_safety_simulation_queue"
	| "g7_governance_ledger";

/**
 * Human-readable label for each ledger source.
 */
export const LEDGER_SOURCE_LABELS: Record<LedgerSource, string> = {
	g1_remediation_runtime: "G1 — Remediation Runtime",
	g2_proposal_db: "G2 — Proposal/Execution DB",
	g3_approval_budget: "G3 — Approval & Budget Recording",
	g4_dry_run_validation: "G4 — Dry-Run & Validation Recording",
	g5_budget_policy_engine: "G5 — Budget Enforcer & Policy Engine",
	g6_safety_simulation_queue: "G6 — Safety, Simulation & Queue",
	g7_governance_ledger: "G7 — Governance Ledger",
};

// ---------------------------------------------------------------------------
// Event Types
// ---------------------------------------------------------------------------

/**
 * Top-level categories for ledger events.
 */
export type LedgerEventCategory =
	| "state_transition"
	| "proposal"
	| "execution_record"
	| "revision"
	| "approval"
	| "change_request"
	| "self_modification"
	| "budget_snapshot"
	| "dry_run"
	| "validation"
	| "validation_failure"
	| "policy_check"
	| "autonomy_classification"
	| "safety_report"
	| "simulation_forecast"
	| "queue_audit"
	| "completion_gate";

/**
 * Severity level for a ledger event.
 */
export type LedgerEventSeverity = "info" | "warning" | "error" | "critical";

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

/**
 * A single entry in the governance ledger.
 * Every event from G1-G6 is normalized into this shape.
 */
export interface LedgerEntry {
	/** Unique entry ID (monotonic within each ledger instance) */
	id: string;
	/** Timestamp (ISO 8601) */
	timestamp: string;
	/** Which component originated this event */
	source: LedgerSource;
	/** Event category */
	category: LedgerEventCategory;
	/** Severity level */
	severity: LedgerEventSeverity;
	/** Human-readable summary */
	summary: string;
	/** Optional plan execution ID */
	planExecId?: string;
	/** Optional workspace ID */
	workspaceId?: string;
	/** Optional detail payload (JSON-serialisable) */
	detail?: Record<string, unknown>;
}

/**
 * Completion gate ledger entry.
 * Recorded when a workspace or plan passes through the completion gate.
 */
export interface CompletionGateRecord {
	/** The ledger entry for this gate event */
	entry: LedgerEntry;
	/** Whether the gate was passed */
	passed: boolean;
	/** Block reasons if not passed */
	blockReasons: string[];
	/** Workspace IDs evaluated (for plan-level gates) */
	workspaceIds?: string[];
}

/**
 * Summary of all ledger entries.
 */
export interface LedgerSummary {
	/** Total entries recorded */
	totalEntries: number;
	/** Entry count by source */
	bySource: Partial<Record<LedgerSource, number>>;
	/** Entry count by category */
	byCategory: Partial<Record<LedgerEventCategory, number>>;
	/** Entry count by severity */
	bySeverity: Partial<Record<LedgerEventSeverity, number>>;
	/** Entries with errors or critical severity */
	criticalEntries: number;
	/** Whether a completion gate entry exists and passed */
	completionGatePassed: boolean;
	/** Timestamp of the first entry */
	firstEntryAt?: string;
	/** Timestamp of the last entry */
	lastEntryAt?: string;
}

/**
 * Complete governance ledger snapshot for persistence and display.
 */
export interface GovernanceLedgerSnapshot {
	/** All entries in the ledger */
	entries: LedgerEntry[];
	/** Current summary */
	summary: LedgerSummary;
	/** Completion gate record if evaluated */
	completionGate?: CompletionGateRecord;
	/** When the ledger was created */
	createdAt: string;
	/** When the ledger was last updated */
	updatedAt: string;
}

// ---------------------------------------------------------------------------
// Governance Ledger
// ---------------------------------------------------------------------------

let _entryCounter = 0;

/**
 * Central governance ledger that collects audit events from G1-G6
 * components and enforces completion gate requirements.
 *
 * The ledger maintains an ordered, immutable list of entries. Each entry
 * carries metadata about its origin source, category, and severity for
 * filtering and reporting.
 */
export class GovernanceLedger {
	private _entries: LedgerEntry[] = [];
	private _completionGate?: CompletionGateRecord;
	private readonly _createdAt: string;

	constructor() {
		this._createdAt = new Date().toISOString();
	}

	// -----------------------------------------------------------------------
	// Accessors
	// -----------------------------------------------------------------------

	/** All recorded entries (immutable view) */
	get entries(): ReadonlyArray<LedgerEntry> {
		return this._entries;
	}

	/** Current ledger summary */
	get summary(): LedgerSummary {
		return this.computeSummary();
	}

	/** Completion gate record, if evaluated */
	get completionGate(): CompletionGateRecord | undefined {
		return this._completionGate;
	}

	/** When the ledger was created */
	get createdAt(): string {
		return this._createdAt;
	}

	/** Whether the ledger has a passing completion gate record */
	get hasPassedCompletionGate(): boolean {
		return this._completionGate?.passed === true;
	}

	// -----------------------------------------------------------------------
	// Recording
	// -----------------------------------------------------------------------

	/**
	 * Record a new entry in the ledger.
	 *
	 * @param source - Component source
	 * @param category - Event category
	 * @param severity - Severity level
	 * @param summary - Human-readable summary
	 * @param options - Optional metadata (planExecId, workspaceId, detail)
	 * @returns The created ledger entry
	 */
	record(
		source: LedgerSource,
		category: LedgerEventCategory,
		severity: LedgerEventSeverity,
		summary: string,
		options?: {
			planExecId?: string;
			workspaceId?: string;
			detail?: Record<string, unknown>;
		},
	): LedgerEntry {
		_entryCounter++;
		const entry: LedgerEntry = {
			id: `ledger-${Date.now()}-${_entryCounter}`,
			timestamp: new Date().toISOString(),
			source,
			category,
			severity,
			summary,
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: options?.detail,
		};

		this._entries.push(entry);
		return entry;
	}

	/**
	 * Record a state transition event (G1).
	 */
	recordStateTransition(
		from: string,
		to: string,
		reason: string,
		options?: { planExecId?: string; workspaceId?: string },
	): LedgerEntry {
		return this.record("g1_remediation_runtime", "state_transition", "info", `State transition: ${from} -> ${to}`, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { from, to, reason },
		});
	}

	/**
	 * Record a proposal event (G2).
	 */
	recordProposal(
		action: "submitted" | "approved" | "rejected" | "updated",
		proposalId: string,
		summary: string,
		options?: { planExecId?: string; workspaceId?: string; detail?: Record<string, unknown> },
	): LedgerEntry {
		return this.record("g2_proposal_db", "proposal", "info", summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { proposalId, action, ...options?.detail },
		});
	}

	/**
	 * Record an execution record event (G2).
	 */
	recordExecutionRecord(
		action: "started" | "completed" | "failed",
		executionId: string,
		summary: string,
		options?: { planExecId?: string; workspaceId?: string; detail?: Record<string, unknown> },
	): LedgerEntry {
		return this.record("g2_proposal_db", "execution_record", action === "failed" ? "error" : "info", summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { executionId, action, ...options?.detail },
		});
	}

	/**
	 * Record an approval event (G3).
	 */
	recordApproval(
		type: "planning" | "execution" | "change_request" | "self_modification",
		decision: "approved" | "rejected" | "requested",
		summary: string,
		options?: {
			planExecId?: string;
			workspaceId?: string;
			reviewer?: string;
			proposalId?: string;
			budgetSnapshot?: Record<string, unknown>;
			detail?: Record<string, unknown>;
		},
	): LedgerEntry {
		const severity: LedgerEventSeverity = decision === "rejected" ? "warning" : "info";
		return this.record("g3_approval_budget", "approval", severity, summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: {
				approvalType: type,
				decision,
				reviewer: options?.reviewer,
				proposalId: options?.proposalId,
				budgetSnapshot: options?.budgetSnapshot,
				...options?.detail,
			},
		});
	}

	/**
	 * Record a budget snapshot (G3/G5).
	 */
	recordBudgetSnapshot(
		budgetSummary: Record<string, unknown>,
		summary: string,
		options?: { planExecId?: string; workspaceId?: string },
	): LedgerEntry {
		return this.record("g5_budget_policy_engine", "budget_snapshot", "info", summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { budgetSummary },
		});
	}

	/**
	 * Record a dry-run event (G4).
	 */
	recordDryRun(
		status: "started" | "completed" | "failed",
		summary: string,
		options?: {
			planExecId?: string;
			workspaceId?: string;
			totalProposals?: number;
			mutationsPredicted?: number;
			detail?: Record<string, unknown>;
		},
	): LedgerEntry {
		const severity: LedgerEventSeverity = status === "failed" ? "error" : "info";
		return this.record("g4_dry_run_validation", "dry_run", severity, summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: {
				status,
				totalProposals: options?.totalProposals,
				mutationsPredicted: options?.mutationsPredicted,
				...options?.detail,
			},
		});
	}

	/**
	 * Record a validation outcome (G4).
	 */
	recordValidation(
		outcome: "passed" | "failed" | "skipped",
		testName: string,
		summary: string,
		options?: { planExecId?: string; workspaceId?: string; detail?: Record<string, unknown> },
	): LedgerEntry {
		const severity: LedgerEventSeverity = outcome === "failed" ? "error" : outcome === "skipped" ? "warning" : "info";
		return this.record("g4_dry_run_validation", "validation", severity, summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { outcome, testName, ...options?.detail },
		});
	}

	/**
	 * Record a validation failure (G4).
	 */
	recordValidationFailure(
		errorMessage: string,
		context: Record<string, unknown>,
		summary: string,
		options?: { planExecId?: string; workspaceId?: string },
	): LedgerEntry {
		return this.record("g4_dry_run_validation", "validation_failure", "error", summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { errorMessage, context },
		});
	}

	/**
	 * Record a policy check (G5).
	 */
	recordPolicyCheck(
		policyName: string,
		passed: boolean,
		isBlocking: boolean,
		summary: string,
		options?: { planExecId?: string; workspaceId?: string; detail?: Record<string, unknown> },
	): LedgerEntry {
		const severity: LedgerEventSeverity = !passed && isBlocking ? "critical" : !passed ? "warning" : "info";
		return this.record("g5_budget_policy_engine", "policy_check", severity, summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { policyName, passed, isBlocking, ...options?.detail },
		});
	}

	/**
	 * Record an autonomy classification (G5).
	 */
	recordAutonomyClassification(
		level: string,
		riskLevel: string,
		summary: string,
		options?: { planExecId?: string; workspaceId?: string; detail?: Record<string, unknown> },
	): LedgerEntry {
		return this.record("g5_budget_policy_engine", "autonomy_classification", "info", summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { autonomyLevel: level, riskLevel, ...options?.detail },
		});
	}

	/**
	 * Record a safety report (G6).
	 */
	recordSafetyReport(
		issueCount: number,
		criticalCount: number,
		summary: string,
		options?: { planExecId?: string; workspaceId?: string; detail?: Record<string, unknown> },
	): LedgerEntry {
		const severity: LedgerEventSeverity = criticalCount > 0 ? "critical" : issueCount > 0 ? "warning" : "info";
		return this.record("g6_safety_simulation_queue", "safety_report", severity, summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { issueCount, criticalCount, ...options?.detail },
		});
	}

	/**
	 * Record a simulation forecast (G6).
	 */
	recordSimulationForecast(
		totalBatches: number,
		estimatedUtilization: number,
		summary: string,
		options?: { planExecId?: string; workspaceId?: string; detail?: Record<string, unknown> },
	): LedgerEntry {
		return this.record("g6_safety_simulation_queue", "simulation_forecast", "info", summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { totalBatches, estimatedUtilization, ...options?.detail },
		});
	}

	/**
	 * Record a queue audit entry (G6).
	 */
	recordQueueAudit(
		action: string,
		workspaceId: string | undefined,
		summary: string,
		options?: { planExecId?: string; detail?: Record<string, unknown> },
	): LedgerEntry {
		return this.record("g6_safety_simulation_queue", "queue_audit", "info", summary, {
			planExecId: options?.planExecId,
			workspaceId,
			detail: { queueAction: action, ...options?.detail },
		});
	}

	/**
	 * Record a change request event (G3).
	 */
	recordChangeRequest(
		action: "submitted" | "approved" | "rejected",
		requestId: string,
		summary: string,
		options?: { planExecId?: string; workspaceId?: string; detail?: Record<string, unknown> },
	): LedgerEntry {
		const severity: LedgerEventSeverity = action === "rejected" ? "warning" : "info";
		return this.record("g3_approval_budget", "change_request", severity, summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { requestId, action, ...options?.detail },
		});
	}

	/**
	 * Record a self-modification event (G3).
	 */
	recordSelfModification(
		approved: boolean,
		affectedPaths: string[],
		summary: string,
		options?: { planExecId?: string; workspaceId?: string; detail?: Record<string, unknown> },
	): LedgerEntry {
		const severity: LedgerEventSeverity = approved ? "warning" : "critical";
		return this.record("g3_approval_budget", "self_modification", severity, summary, {
			planExecId: options?.planExecId,
			workspaceId: options?.workspaceId,
			detail: { approved, affectedPaths, ...options?.detail },
		});
	}

	// -----------------------------------------------------------------------
	// Completion Gate
	// -----------------------------------------------------------------------

	/**
	 * Record a completion gate evaluation.
	 *
	 * This MUST be called before marking any workspace or plan complete.
	 * The completion gate requires a complete ledger entry to proceed.
	 *
	 * @param passed - Whether the gate passed
	 * @param blockReasons - Reasons the gate blocked (empty if passed)
	 * @param options - Optional context
	 * @returns The completion gate record
	 */
	recordCompletionGate(
		passed: boolean,
		blockReasons: string[] = [],
		options?: {
			planExecId?: string;
			workspaceId?: string;
			workspaceIds?: string[];
		},
	): CompletionGateRecord {
		const entry = this.record(
			"g7_governance_ledger",
			"completion_gate",
			passed ? "info" : "error",
			passed
				? "Completion gate passed — all checks satisfied"
				: `Completion gate blocked: ${blockReasons.join("; ")}`,
			{
				planExecId: options?.planExecId,
				workspaceId: options?.workspaceId,
				detail: {
					passed,
					blockReasons,
					workspaceIds: options?.workspaceIds,
				},
			},
		);

		this._completionGate = {
			entry,
			passed,
			blockReasons,
			workspaceIds: options?.workspaceIds,
		};

		return this._completionGate;
	}

	/**
	 * Check whether a plan can proceed through the completion gate.
	 * Requires at least one ledger entry (a "complete entry") and
	 * that no blocking conditions exist.
	 *
	 * @param _options - Optional context (planExecId, workspaceId, workspaceIds)
	 *   for recording context in the completion gate entry if one is created.
	 * @returns Object with passed flag and block reasons
	 */
	checkCompletionGate(_options?: { planExecId?: string; workspaceId?: string; workspaceIds?: string[] }): {
		passed: boolean;
		blockReasons: string[];
	} {
		const blockReasons: string[] = [];

		// Require at least one ledger entry
		if (this._entries.length === 0) {
			blockReasons.push("Governance ledger is empty — no entries recorded");
		}

		// Require no critical errors without a resolution
		const unresolvedCritical = this._entries.filter((e) => e.severity === "critical" || e.severity === "error");
		if (unresolvedCritical.length > 0) {
			blockReasons.push(`Governance ledger has ${unresolvedCritical.length} unresolved error/critical entries`);
		}

		// Require no validation failures without resolution
		const unresolvedFailures = this._entries.filter(
			(e) => e.category === "validation_failure" && e.severity === "error",
		);
		if (unresolvedFailures.length > 0) {
			blockReasons.push(`Governance ledger has ${unresolvedFailures.length} unresolved validation failures`);
		}

		// Require at least one entry from each of G3, G4 if the lifecycle has progressed
		// (This is a soft check - we record it as info but don't block on it)
		const hasApprovalEntries = this._entries.some((e) => e.source === "g3_approval_budget");
		const hasValidationEntries = this._entries.some((e) => e.source === "g4_dry_run_validation");

		if (!hasApprovalEntries) {
			blockReasons.push("No approval entries (G3) recorded in governance ledger");
		}

		if (!hasValidationEntries) {
			blockReasons.push("No validation entries (G4) recorded in governance ledger");
		}

		const passed = blockReasons.length === 0;
		return { passed, blockReasons };
	}

	// -----------------------------------------------------------------------
	// Summary
	// -----------------------------------------------------------------------

	/**
	 * Compute a summary of the current ledger state.
	 */
	computeSummary(): LedgerSummary {
		const bySource: Partial<Record<LedgerSource, number>> = {};
		const byCategory: Partial<Record<LedgerEventCategory, number>> = {};
		const bySeverity: Partial<Record<LedgerEventSeverity, number>> = {};

		let criticalCount = 0;

		for (const entry of this._entries) {
			bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
			byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
			bySeverity[entry.severity] = (bySeverity[entry.severity] ?? 0) + 1;

			if (entry.severity === "critical" || entry.severity === "error") {
				criticalCount++;
			}
		}

		return {
			totalEntries: this._entries.length,
			bySource,
			byCategory,
			bySeverity,
			criticalEntries: criticalCount,
			completionGatePassed: this._completionGate?.passed === true,
			firstEntryAt: this._entries.length > 0 ? this._entries[0].timestamp : undefined,
			lastEntryAt: this._entries.length > 0 ? this._entries[this._entries.length - 1].timestamp : undefined,
		};
	}

	/**
	 * Take a full snapshot of the ledger.
	 */
	snapshot(): GovernanceLedgerSnapshot {
		return {
			entries: [...this._entries],
			summary: this.computeSummary(),
			completionGate: this._completionGate,
			createdAt: this._createdAt,
			updatedAt: this._entries.length > 0 ? this._entries[this._entries.length - 1].timestamp : this._createdAt,
		};
	}

	/**
	 * Clear all entries (for testing / reset).
	 */
	clear(): void {
		this._entries = [];
		this._completionGate = undefined;
	}
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

/**
 * Create a new governance ledger instance.
 */
export function createGovernanceLedger(): GovernanceLedger {
	return new GovernanceLedger();
}

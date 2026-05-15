/**
 * Remediation Runtime - P9.A Approval-Gated Remediation Runtime
 *
 * A state machine that manages the lifecycle of applying remediation proposals
 * from the repo health scanner, with two separate approval gates:
 *
 *   1. Planning approval — Approve the remediation plan before dry-run
 *   2. Execution approval — Approve actual execution after dry-run
 *
 * The runtime enforces that execution cannot proceed without a completed
 * dry-run and explicit execution approval.
 *
 * State machine:
 *
 *   Idle
 *    │
 *    ├──[plan]──> Scanning ──> ScanComplete
 *    │                           │
 *    │                    ┌──────┴──────┐
 *    │                    │ (auto)      │
 *    │                    v              v
 *    │            PlanningApproval   PlanningRejected
 *    │            Pending
 *    │              │
 *    │        ┌─────┴──────┐
 *    │        │            │
 *    │        v            v
 *    │   Planning      Planning
 *    │   Approved      Rejected
 *    │      │
 *    │      ├──[requestDryRun]──> DryRunPending
 *    │      │                        │
 *    │      │                   ┌────┴────┐
 *    │      │                   │ (auto)  │
 *    │      │                   v         v
 *    │      │              DryRunning   Failed
 *    │      │                   │
 *    │      │                   v
 *    │      │              DryRunComplete
 *    │      │                   │
 *    │      ├──[execute]──> ExecutionApprovalPending
 *    │      │                   │
 *    │      │              ┌────┴─────────┐
 *    │      │              │              │
 *    │      │              v              v
 *    │      │         Execution       Execution
 *    │      │         Approved        Rejected
 *    │      │              │
 *    │      │              v
 *    │      ├─────────> Executing ──> Complete
 *    │      │
 *    │      v
 *    │   Failed
 *    │
 *    └──[reset]──> Idle
 *
 * Key invariants:
 * - planning_approval_pending → planning_approved (Gate 1)
 * - dry_run_complete → execution_approved (Gate 2)
 * - Dry-run MUST complete before execution approval is possible
 * - Cannot execute without execution_approved + dry_run_complete
 */

import type { HealthSignal, SignalProposal } from "../repo-scanner/repo-health-signal.js";
import type { BudgetSummary } from "./budget-enforcer.js";

// ---------------------------------------------------------------------------
// Remediation Runtime States
// ---------------------------------------------------------------------------

/**
 * All possible states of the remediation runtime.
 */
export type RemediationState =
	| "idle"
	| "scanning"
	| "scan_complete"
	| "planning_approval_pending"
	| "planning_approved"
	| "planning_rejected"
	| "dry_run_pending"
	| "dry_running"
	| "dry_run_complete"
	| "execution_approval_pending"
	| "execution_approved"
	| "execution_rejected"
	| "executing"
	| "complete"
	| "failed";

/**
 * Human-readable label for each state.
 */
export const REMEDIATION_STATE_LABELS: Record<RemediationState, string> = {
	idle: "Idle",
	scanning: "Scanning repository",
	scan_complete: "Scan complete",
	planning_approval_pending: "Awaiting planning approval",
	planning_approved: "Planning approved",
	planning_rejected: "Planning rejected",
	dry_run_pending: "Ready for dry-run",
	dry_running: "Running dry-run simulation",
	dry_run_complete: "Dry-run complete",
	execution_approval_pending: "Awaiting execution approval",
	execution_approved: "Execution approved",
	execution_rejected: "Execution rejected",
	executing: "Executing remediation",
	complete: "Complete",
	failed: "Failed",
};

// ---------------------------------------------------------------------------
// Transition Definitions
// ---------------------------------------------------------------------------

/**
 * Valid transitions from each state.
 * Maps current state -> set of allowed next states.
 */
const VALID_TRANSITIONS: Record<RemediationState, RemediationState[]> = {
	idle: ["scanning"],
	scanning: ["scan_complete", "failed"],
	scan_complete: ["planning_approval_pending", "planning_rejected", "failed"],
	planning_approval_pending: ["planning_approved", "planning_rejected", "failed"],
	planning_approved: ["dry_run_pending", "planning_approval_pending", "failed"],
	planning_rejected: ["idle", "failed"],
	dry_run_pending: ["dry_running", "failed"],
	dry_running: ["dry_run_complete", "failed"],
	dry_run_complete: ["execution_approval_pending", "planning_approval_pending", "planning_approved", "failed"],
	execution_approval_pending: ["execution_approved", "execution_rejected", "failed"],
	execution_approved: ["executing", "dry_run_pending", "failed"],
	execution_rejected: ["idle", "planning_approval_pending", "failed"],
	executing: ["complete", "failed"],
	complete: ["idle"],
	failed: ["idle"],
};

// ---------------------------------------------------------------------------
// Approval Events & Status
// ---------------------------------------------------------------------------

/**
 * Approval event recorded in the audit trail.
 */
export interface ApprovalEvent {
	/** Type of approval */
	type: "planning" | "execution" | "change_request" | "self_modification";
	/** Decision */
	decision: "approved" | "rejected" | "requested";
	/** Timestamp (ISO 8601) */
	timestamp: string;
	/** Optional reviewer identity */
	reviewer?: string;
	/** Optional reason or comment */
	reason?: string;
	/** Budget snapshot captured at the time of this event (P9.G3) */
	budgetSnapshot?: BudgetSummary;
	/** Reference to the associated proposal ID (for chain tracing) */
	proposalId?: string;
}

/**
 * A formal change request submitted during the remediation lifecycle.
 * Requests modification to an approved plan or execution approach.
 * P9.G3 field.
 */
export interface ChangeRequest {
	/** Unique identifier for this change request */
	id: string;
	/** Description of the requested change */
	description: string;
	/** Rationale for the change */
	rationale: string;
	/** Optional before-state description */
	currentState?: string;
	/** Optional after-state description */
	proposedState?: string;
	/** Optional risk assessment */
	riskAssessment?: string;
	/** When the change was requested (ISO 8601) */
	requestedAt: string;
	/** Who requested the change */
	requestedBy?: string;
	/** Current status of the change request */
	status: "pending" | "approved" | "rejected";
	/** Resolution event (filled when approved or rejected) */
	resolution?: ApprovalEvent;
}

/**
 * Record of a self-modification approval.
 * Self-modification refers to changes to pi's own protected systems
 * (packages/, .pi/agent/, .pi/settings.json, .pi/skills/).
 * P9.G3 field.
 */
export interface SelfModificationApproval {
	/** Timestamp of the approval (ISO 8601) */
	timestamp: string;
	/** Whether self-modification was approved */
	approved: boolean;
	/** What protected systems are affected */
	affectedPaths: string[];
	/** Reason for the approval or denial */
	reason: string;
	/** Optional associated ApprovalEvent */
	event?: ApprovalEvent;
}

/**
 * A single entry in the approval chain, tracing from proposal through
 * each approval gate to final execution.
 * P9.G3 field.
 */
export interface ApprovalChainEntry {
	/** Step in the chain (1-based) */
	step: number;
	/** Type of gate */
	gate: "proposal" | "planning" | "change_request" | "self_modification" | "execution";
	/** Decision made */
	decision: "submitted" | "approved" | "rejected" | "requested";
	/** Timestamp (ISO 8601) */
	timestamp: string;
	/** Who/what made the decision */
	actor?: string;
	/** Reason for the decision */
	reason?: string;
	/** Reference to the associated proposal or request ID */
	referenceId?: string;
	/** Budget snapshot at this decision point */
	budgetSnapshot?: BudgetSummary;
}

/**
 * The complete approval chain from initial proposal through
 * planning and execution approvals.
 * P9.G3 field.
 */
export interface ApprovalChain {
	/** All entries in the chain, in chronological order */
	entries: ApprovalChainEntry[];
	/** The originating proposal ID, if applicable */
	proposalId?: string;
	/** Timestamp when the chain was started */
	startedAt: string;
	/** Timestamp when the chain was completed */
	completedAt?: string;
}

/**
 * Current approval status for all gates, including change requests
 * and self-modification approvals.
 * P9.G3: Extended with changeRequest and selfModification fields.
 */
export interface ApprovalStatus {
	/** Planning approval (Gate 1) */
	planning: {
		approved: boolean;
		rejected: boolean;
		event?: ApprovalEvent;
	};
	/** Execution approval (Gate 2) */
	execution: {
		approved: boolean;
		rejected: boolean;
		event?: ApprovalEvent;
	};
	/** Change request tracking (P9.G3) */
	changeRequest?: {
		active: boolean;
		requests: ChangeRequest[];
	};
	/** Self-modification approval tracking (P9.G3) */
	selfModification?: {
		approved: boolean;
		event?: ApprovalEvent;
	};
}

// ---------------------------------------------------------------------------
// Dry-Run Report
// ---------------------------------------------------------------------------

/**
 * Result of a dry-run simulation.
 */
export interface DryRunReport {
	/** Timestamp (ISO 8601) */
	timestamp: string;
	/** Total number of proposals simulated */
	totalProposals: number;
	/** Proposals that would modify files */
	mutationsPredicted: number;
	/** Expected file changes (paths) */
	expectedFileChanges: string[];
	/** Whether the dry-run completed without errors */
	success: boolean;
	/** Error message if failed */
	error?: string;
	/** Detailed forecast (JSON blob) */
	forecast?: Record<string, unknown>;
	/**
	 * Budget and blast-radius summary for the dry-run.
	 * Included when budget enforcement is active.
	 * P9.E field.
	 */
	budgetSummary?: BudgetSummary;
}

// ---------------------------------------------------------------------------
// Remediation Scan Result
// ---------------------------------------------------------------------------

/**
 * Result of a scan that feeds into the remediation runtime.
 */
export interface RemediationScanResult {
	/** Health signals produced by the scan */
	signals: HealthSignal[];
	/** Total proposals across all signals */
	totalProposals: number;
	/** Aggregated proposals (flat list for execution) */
	proposals: SignalProposal[];
	/** When the scan completed (ISO 8601) */
	completedAt: string;
}

// ---------------------------------------------------------------------------
// Events & Snapshot
// ---------------------------------------------------------------------------

/**
 * A single state transition event recorded in the journal.
 */
export interface TransitionEvent {
	/** Previous state */
	from: RemediationState;
	/** New state */
	to: RemediationState;
	/** Timestamp (ISO 8601) */
	timestamp: string;
	/** Why the transition occurred */
	reason: string;
}

/**
 * Full snapshot of the remediation runtime state (for persistence/display).
 */
export interface RemediationSnapshot {
	/** Current state */
	state: RemediationState;
	/** Approval status (all gates including P9.G3 extensions) */
	approvalStatus: ApprovalStatus;
	/** Scan result if available */
	scanResult?: RemediationScanResult;
	/** Dry-run report if available */
	dryRunReport?: DryRunReport;
	/** Error message if state is "failed" */
	error?: string;
	/** Transition journal (audit trail) */
	journal: TransitionEvent[];
	/** When the runtime was created (ISO 8601) */
	createdAt: string;
	/** When the runtime last transitioned (ISO 8601) */
	updatedAt: string;
	/**
	 * Budget and blast-radius summary for this snapshot.
	 * Included when budget enforcement is active, for display in
	 * approval artifacts and approval UX.
	 * P9.E field.
	 */
	budgetSummary?: BudgetSummary;
	/**
	 * Budget snapshot captured at the time of the last approval event.
	 * Persisted at approval time for audit and traceability.
	 * P9.G3 field.
	 */
	budgetSnapshot?: BudgetSummary;
	/**
	 * Active change requests in the remediation lifecycle.
	 * P9.G3 field.
	 */
	changeRequests?: ChangeRequest[];
	/**
	 * Self-modification approvals recorded during remediation.
	 * P9.G3 field.
	 */
	selfModificationApprovals?: SelfModificationApproval[];
	/**
	 * Complete approval chain from proposal to execution.
	 * P9.G3 field.
	 */
	approvalChain?: ApprovalChain;
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

/**
 * Error thrown when an invalid state transition is attempted.
 */
export class InvalidTransitionError extends Error {
	constructor(from: RemediationState, to: RemediationState) {
		super(`Invalid transition: ${from} -> ${to}`);
		this.name = "InvalidTransitionError";
	}
}

/**
 * Error thrown when a precondition is not met.
 */
export class PreconditionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PreconditionError";
	}
}

// ---------------------------------------------------------------------------
// Remediation Runtime
// ---------------------------------------------------------------------------

/**
 * Configuration for the remediation runtime.
 */
export interface RemediationRuntimeConfig {
	/** Optional reviewer identity for approval events */
	reviewer?: string;
	/**
	 * Optional budget enforcer for capturing budget snapshots at
	 * approval time. When provided, the budget summary is captured
	 * and persisted in approval events and snapshots.
	 * P9.G3 field.
	 */
	budgetEnforcer?: import("./budget-enforcer.js").BudgetEnforcer;
	/**
	 * Optional proposal ID for tracing the approval chain from
	 * initial proposal through planning and execution.
	 * P9.G3 field.
	 */
	proposalId?: string;
}

/**
 * Approval-gated remediation runtime.
 *
 * Manages the lifecycle of applying scanner-identified remediations with
 * two separate approval gates (planning + execution) and mandatory dry-run.
 *
 * P9.G3: Extended with change request handling, self-modification approval
 * recording, budget snapshots at approval time, and full approval chain
 * traceability.
 */
export class RemediationRuntime {
	/** Current state */
	private _state: RemediationState = "idle";

	/** Approval status for all gates */
	private _approvalStatus: ApprovalStatus = {
		planning: { approved: false, rejected: false },
		execution: { approved: false, rejected: false },
	};

	/** Scan result (populated after scan completes) */
	private _scanResult?: RemediationScanResult;

	/** Dry-run report (populated after dry-run completes) */
	private _dryRunReport?: DryRunReport;

	/** Transition journal (audit trail) */
	private _journal: TransitionEvent[] = [];

	/** Error message (set when state is "failed") */
	private _error?: string;

	/** Config */
	private _config: {
		reviewer: string;
		budgetEnforcer?: import("./budget-enforcer.js").BudgetEnforcer;
		proposalId?: string;
	};

	/** Creation timestamp */
	private readonly _createdAt: string;

	/** Change requests (P9.G3) */
	private _changeRequests: ChangeRequest[] = [];

	/** Self-modification approvals (P9.G3) */
	private _selfModificationApprovals: SelfModificationApproval[] = [];

	/** Approval chain (P9.G3) */
	private _approvalChain: ApprovalChainEntry[] = [];

	/** Budget snapshot captured at the last approval event (P9.G3) */
	private _budgetSnapshot?: BudgetSummary;

	constructor(config?: RemediationRuntimeConfig) {
		this._config = {
			reviewer: config?.reviewer ?? "unknown",
			budgetEnforcer: config?.budgetEnforcer,
			proposalId: config?.proposalId,
		};
		this._createdAt = new Date().toISOString();

		// If a proposal ID was provided, record the initial proposal chain entry
		if (config?.proposalId) {
			this._approvalChain.push({
				step: 1,
				gate: "proposal",
				decision: "submitted",
				timestamp: this._createdAt,
				referenceId: config.proposalId,
				reason: "Proposal submitted for review",
			});
		}
	}

	// -----------------------------------------------------------------------
	// Accessors
	// -----------------------------------------------------------------------

	/** Current state */
	get state(): RemediationState {
		return this._state;
	}

	/** Approval status for both gates */
	get approvalStatus(): ApprovalStatus {
		return this._approvalStatus;
	}

	/** Scan result (undefined if not yet scanned) */
	get scanResult(): RemediationScanResult | undefined {
		return this._scanResult;
	}

	/** Dry-run report (undefined if not yet run) */
	get dryRunReport(): DryRunReport | undefined {
		return this._dryRunReport;
	}

	/** Transition journal */
	get journal(): ReadonlyArray<TransitionEvent> {
		return this._journal;
	}

	/** Error message (undefined unless state is "failed") */
	get error(): string | undefined {
		return this._error;
	}

	/** Whether state is a terminal state */
	get isTerminal(): boolean {
		return this._state === "complete" || this._state === "failed";
	}

	/** Change requests (P9.G3) */
	get changeRequests(): ReadonlyArray<ChangeRequest> {
		return this._changeRequests;
	}

	/** Self-modification approvals (P9.G3) */
	get selfModificationApprovals(): ReadonlyArray<SelfModificationApproval> {
		return this._selfModificationApprovals;
	}

	/** Approval chain entries (P9.G3) */
	get approvalChain(): ReadonlyArray<ApprovalChainEntry> {
		return this._approvalChain;
	}

	/** Budget snapshot captured at the last approval event (P9.G3) */
	get budgetSnapshot(): BudgetSummary | undefined {
		return this._budgetSnapshot;
	}

	// -----------------------------------------------------------------------
	// Transition helpers
	// -----------------------------------------------------------------------

	/**
	 * Validate and perform a state transition.
	 *
	 * @param to - Target state
	 * @param reason - Human-readable reason for the transition
	 * @throws {InvalidTransitionError} If the transition is not allowed
	 */
	private async transition(to: RemediationState, reason: string): Promise<void> {
		const from = this._state;
		const allowed = VALID_TRANSITIONS[from];

		if (!allowed?.includes(to)) {
			throw new InvalidTransitionError(from, to);
		}

		this._state = to;
		const timestamp = new Date().toISOString();

		this._journal.push({
			from,
			to,
			timestamp,
			reason,
		});

		// If transitioning to failed, ensure error is set
		if (to === "failed" && !this._error) {
			this._error = reason;
		}

		// Clear error when leaving failed state
		if (from === "failed" && to !== "failed") {
			this._error = undefined;
		}
	}

	// -----------------------------------------------------------------------
	// Helpers — Budget Snapshots & Approval Chain (P9.G3)
	// -----------------------------------------------------------------------

	/**
	 * Capture a budget snapshot using the configured budget enforcer.
	 * Returns undefined if no budget enforcer is configured.
	 * P9.G3 helper.
	 */
	private captureBudgetSnapshot(): BudgetSummary | undefined {
		if (!this._config.budgetEnforcer) {
			return undefined;
		}
		const snapshot = this._config.budgetEnforcer.buildBudgetSummary();
		this._budgetSnapshot = snapshot;
		return snapshot;
	}

	/**
	 * Add an entry to the approval chain.
	 * P9.G3 helper.
	 */
	private addApprovalChainEntry(entry: Omit<ApprovalChainEntry, "step" | "budgetSnapshot">): void {
		this._approvalChain.push({
			...entry,
			step: this._approvalChain.length + 1,
			budgetSnapshot: this.captureBudgetSnapshot(),
		});
	}

	// -----------------------------------------------------------------------
	// Public API — Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Start a scan. Transitions from Idle -> Scanning.
	 *
	 * After the scan completes, the runtime automatically advances to
	 * PlanningApprovalPending (or PlanningRejected if no proposals found).
	 *
	 * @param scanFn - Async function that performs the scan and returns results
	 */
	async plan(scanFn: () => Promise<RemediationScanResult>): Promise<void> {
		await this.transition("scanning", "Initiated repository scan");

		try {
			const result = await scanFn();
			this._scanResult = result;
			await this.transition("scan_complete", `Scan completed with ${result.totalProposals} proposals`);

			if (result.totalProposals === 0) {
				await this.transition("planning_rejected", "No proposals found — nothing to remediate");
			} else {
				await this.transition(
					"planning_approval_pending",
					`${result.totalProposals} proposals ready for planning approval`,
				);
			}
		} catch (error) {
			this._error = error instanceof Error ? error.message : String(error);
			await this.transition("failed", `Scan failed: ${this._error}`);
		}
	}

	/**
	 * Approve the remediation plan. Gate 1.
	 *
	 * Required state: planning_approval_pending
	 *
	 * Budget snapshot is captured at approval time (P9.G3 AC2).
	 * Approval chain entry is added (P9.G3 AC3).
	 *
	 * @param reason - Optional reason for approval
	 */
	async approvePlan(reason?: string): Promise<void> {
		if (this._state !== "planning_approval_pending") {
			throw new PreconditionError(
				`Cannot approve plan: current state is ${this._state}, expected planning_approval_pending`,
			);
		}

		await this.transition("planning_approved", reason ?? "Plan approved");

		// Capture budget snapshot at approval time (P9.G3 AC2)
		const budgetSnapshot = this.captureBudgetSnapshot();

		this._approvalStatus = {
			...this._approvalStatus,
			planning: {
				approved: true,
				rejected: false,
				event: {
					type: "planning",
					decision: "approved",
					timestamp: new Date().toISOString(),
					reviewer: this._config.reviewer,
					reason,
					budgetSnapshot,
					proposalId: this._config.proposalId,
				},
			},
		};

		// Add approval chain entry (P9.G3 AC3)
		this.addApprovalChainEntry({
			gate: "planning",
			decision: "approved",
			timestamp: new Date().toISOString(),
			actor: this._config.reviewer,
			reason,
			referenceId: this._config.proposalId,
		});
	}

	/**
	 * Reject the remediation plan. Gate 1 (negative).
	 *
	 * Required state: planning_approval_pending
	 *
	 * Budget snapshot is captured at rejection time (P9.G3 AC2).
	 * Approval chain entry is added (P9.G3 AC3).
	 *
	 * @param reason - Reason for rejection
	 */
	async rejectPlan(reason: string): Promise<void> {
		if (this._state !== "planning_approval_pending") {
			throw new PreconditionError(
				`Cannot reject plan: current state is ${this._state}, expected planning_approval_pending`,
			);
		}

		await this.transition("planning_rejected", reason);

		// Capture budget snapshot at rejection time (P9.G3 AC2)
		const budgetSnapshot = this.captureBudgetSnapshot();

		this._approvalStatus = {
			...this._approvalStatus,
			planning: {
				approved: false,
				rejected: true,
				event: {
					type: "planning",
					decision: "rejected",
					timestamp: new Date().toISOString(),
					reviewer: this._config.reviewer,
					reason,
					budgetSnapshot,
					proposalId: this._config.proposalId,
				},
			},
		};

		// Add approval chain entry (P9.G3 AC3)
		this.addApprovalChainEntry({
			gate: "planning",
			decision: "rejected",
			timestamp: new Date().toISOString(),
			actor: this._config.reviewer,
			reason,
			referenceId: this._config.proposalId,
		});
	}

	/**
	 * Request a dry-run. Transitions from planning_approved -> dry_run_pending.
	 *
	 * Required state: planning_approved
	 */
	async requestDryRun(): Promise<void> {
		if (this._state !== "planning_approved") {
			throw new PreconditionError(
				`Cannot request dry-run: current state is ${this._state}, expected planning_approved`,
			);
		}

		await this.transition("dry_run_pending", "Dry-run requested");
	}

	/**
	 * Run the dry-run simulation. Transitions from dry_run_pending -> dry_running -> dry_run_complete.
	 *
	 * Required state: dry_run_pending
	 *
	 * @param dryRunFn - Async function that performs the dry-run and returns a report
	 */
	async runDryRun(dryRunFn: () => Promise<DryRunReport>): Promise<void> {
		if (this._state !== "dry_run_pending") {
			throw new PreconditionError(`Cannot run dry-run: current state is ${this._state}, expected dry_run_pending`);
		}

		await this.transition("dry_running", "Dry-run in progress");

		try {
			const report = await dryRunFn();
			this._dryRunReport = report;
			if (report.success) {
				await this.transition(
					"dry_run_complete",
					`Dry-run completed: ${report.totalProposals} proposals simulated`,
				);
			} else {
				this._error = report.error;
				await this.transition("failed", `Dry-run failed: ${report.error}`);
			}
		} catch (error) {
			this._error = error instanceof Error ? error.message : String(error);
			await this.transition("failed", `Dry-run execution failed: ${this._error}`);
		}
	}

	/**
	 * Approve execution after dry-run. Gate 2.
	 *
	 * Required state: dry_run_complete
	 *
	 * Budget snapshot is captured at approval time (P9.G3 AC2).
	 * Approval chain entry is added (P9.G3 AC3).
	 *
	 * @param reason - Optional reason for approval
	 */
	async approveExecution(reason?: string): Promise<void> {
		if (this._state !== "dry_run_complete") {
			throw new PreconditionError(
				`Cannot approve execution: current state is ${this._state}, expected dry_run_complete`,
			);
		}

		// Transition through execution_approval_pending for audit trail
		await this.transition("execution_approval_pending", "Explicit execution approval pending");
		await this.transition("execution_approved", reason ?? "Execution approved");

		// Capture budget snapshot at approval time (P9.G3 AC2)
		const budgetSnapshot = this.captureBudgetSnapshot();

		this._approvalStatus = {
			...this._approvalStatus,
			execution: {
				approved: true,
				rejected: false,
				event: {
					type: "execution",
					decision: "approved",
					timestamp: new Date().toISOString(),
					reviewer: this._config.reviewer,
					reason,
					budgetSnapshot,
					proposalId: this._config.proposalId,
				},
			},
		};

		// Add approval chain entry (P9.G3 AC3)
		this.addApprovalChainEntry({
			gate: "execution",
			decision: "approved",
			timestamp: new Date().toISOString(),
			actor: this._config.reviewer,
			reason,
			referenceId: this._config.proposalId,
		});
	}

	/**
	 * Reject execution after dry-run. Gate 2 (negative).
	 *
	 * Required state: dry_run_complete
	 *
	 * Budget snapshot is captured at rejection time (P9.G3 AC2).
	 * Approval chain entry is added (P9.G3 AC3).
	 *
	 * @param reason - Reason for rejection
	 */
	async rejectExecution(reason: string): Promise<void> {
		if (this._state !== "dry_run_complete") {
			throw new PreconditionError(
				`Cannot reject execution: current state is ${this._state}, expected dry_run_complete`,
			);
		}

		await this.transition("execution_approval_pending", "Explicit execution rejection");
		await this.transition("execution_rejected", reason);

		// Capture budget snapshot at rejection time (P9.G3 AC2)
		const budgetSnapshot = this.captureBudgetSnapshot();

		this._approvalStatus = {
			...this._approvalStatus,
			execution: {
				approved: false,
				rejected: true,
				event: {
					type: "execution",
					decision: "rejected",
					timestamp: new Date().toISOString(),
					reviewer: this._config.reviewer,
					reason,
					budgetSnapshot,
					proposalId: this._config.proposalId,
				},
			},
		};

		// Add approval chain entry (P9.G3 AC3)
		this.addApprovalChainEntry({
			gate: "execution",
			decision: "rejected",
			timestamp: new Date().toISOString(),
			actor: this._config.reviewer,
			reason,
			referenceId: this._config.proposalId,
		});
	}

	/**
	 * Execute the approved remediation.
	 *
	 * Required state: execution_approved
	 *
	 * @param executeFn - Async function that applies the remediation
	 */
	async execute(executeFn: () => Promise<void>): Promise<void> {
		if (this._state !== "execution_approved") {
			const hint =
				this._state === "dry_run_complete"
					? " Dry-run is complete. Call approveExecution() to explicitly approve execution."
					: "";
			throw new PreconditionError(
				`Cannot execute: current state is ${this._state}. ` +
					`Execution requires state "execution_approved", which in turn requires a completed dry-run ` +
					`(state "dry_run_complete") and explicit execution approval.${hint}`,
			);
		}

		// Double-check: execution must have dry-run complete
		if (!this._dryRunReport) {
			throw new PreconditionError(
				"Cannot execute: dry-run report is missing. Dry-run must complete before execution.",
			);
		}

		await this.transition("executing", "Starting remediation execution");

		try {
			await executeFn();
			await this.transition("complete", "Remediation execution completed");
		} catch (error) {
			this._error = error instanceof Error ? error.message : String(error);
			await this.transition("failed", `Execution failed: ${this._error}`);
		}
	}

	// -----------------------------------------------------------------------
	// P9.G3 — Change Request Methods
	// -----------------------------------------------------------------------

	/**
	 * Submit a formal change request during the remediation lifecycle.
	 * Change requests are recorded and can be approved or rejected.
	 * P9.G3 AC1: Change requests are recorded.
	 *
	 * Allowed from: planning_approval_pending, planning_approved,
	 * dry_run_complete, execution_approval_pending
	 *
	 * @param description - Description of the requested change
	 * @param rationale - Rationale for the change
	 * @param options - Optional additional details
	 * @returns The created change request
	 */
	async requestChange(
		description: string,
		rationale: string,
		options?: {
			currentState?: string;
			proposedState?: string;
			riskAssessment?: string;
			requestedBy?: string;
		},
	): Promise<ChangeRequest> {
		const allowedStates: RemediationState[] = [
			"planning_approval_pending",
			"planning_approved",
			"dry_run_complete",
			"execution_approval_pending",
		];

		if (!allowedStates.includes(this._state)) {
			throw new PreconditionError(
				`Cannot request change: current state is ${this._state}. ` +
					`Change requests are only allowed from: ${allowedStates.join(", ")}`,
			);
		}

		const changeRequest: ChangeRequest = {
			id: `cr-${Date.now()}-${this._changeRequests.length + 1}`,
			description,
			rationale,
			currentState: options?.currentState,
			proposedState: options?.proposedState,
			riskAssessment: options?.riskAssessment,
			requestedAt: new Date().toISOString(),
			requestedBy: options?.requestedBy ?? this._config.reviewer,
			status: "pending",
		};

		this._changeRequests.push(changeRequest);

		// Update approval status with the change request
		this._approvalStatus = {
			...this._approvalStatus,
			changeRequest: {
				active: true,
				requests: [...this._changeRequests],
			},
		};

		// Journal a non-state-transition event for audit trail
		this._journal.push({
			from: this._state,
			to: this._state as RemediationState,
			timestamp: new Date().toISOString(),
			reason: `Change request submitted: ${description} (${changeRequest.id})`,
		});

		// Add approval chain entry
		this.addApprovalChainEntry({
			gate: "change_request",
			decision: "requested",
			timestamp: changeRequest.requestedAt,
			actor: changeRequest.requestedBy,
			reason: rationale,
			referenceId: changeRequest.id,
		});

		return changeRequest;
	}

	/**
	 * Approve a pending change request.
	 * P9.G3 AC1: Change request approvals are recorded.
	 *
	 * @param changeRequestId - ID of the change request to approve
	 * @param reason - Optional reason for approval
	 */
	async approveChange(changeRequestId: string, reason?: string): Promise<void> {
		const request = this._changeRequests.find((r) => r.id === changeRequestId);
		if (!request) {
			throw new PreconditionError(`Change request not found: ${changeRequestId}`);
		}
		if (request.status !== "pending") {
			throw new PreconditionError(
				`Change request ${changeRequestId} is already ${request.status}. Only pending requests can be approved.`,
			);
		}

		request.status = "approved";
		const approvalEvent: ApprovalEvent = {
			type: "change_request",
			decision: "approved",
			timestamp: new Date().toISOString(),
			reviewer: this._config.reviewer,
			reason,
			budgetSnapshot: this.captureBudgetSnapshot(),
			proposalId: this._config.proposalId,
		};
		request.resolution = approvalEvent;

		// Update approval status
		this._approvalStatus = {
			...this._approvalStatus,
			changeRequest: {
				active: false,
				requests: [...this._changeRequests],
			},
		};

		// Add approval chain entry
		this.addApprovalChainEntry({
			gate: "change_request",
			decision: "approved",
			timestamp: approvalEvent.timestamp,
			actor: this._config.reviewer,
			reason,
			referenceId: changeRequestId,
		});
	}

	/**
	 * Reject a pending change request.
	 * P9.G3 AC1: Change request rejections are recorded.
	 *
	 * @param changeRequestId - ID of the change request to reject
	 * @param reason - Reason for rejection
	 */
	async rejectChange(changeRequestId: string, reason: string): Promise<void> {
		const request = this._changeRequests.find((r) => r.id === changeRequestId);
		if (!request) {
			throw new PreconditionError(`Change request not found: ${changeRequestId}`);
		}
		if (request.status !== "pending") {
			throw new PreconditionError(
				`Change request ${changeRequestId} is already ${request.status}. Only pending requests can be rejected.`,
			);
		}

		request.status = "rejected";
		const rejectionEvent: ApprovalEvent = {
			type: "change_request",
			decision: "rejected",
			timestamp: new Date().toISOString(),
			reviewer: this._config.reviewer,
			reason,
			budgetSnapshot: this.captureBudgetSnapshot(),
			proposalId: this._config.proposalId,
		};
		request.resolution = rejectionEvent;

		// Update approval status
		this._approvalStatus = {
			...this._approvalStatus,
			changeRequest: {
				active: false,
				requests: [...this._changeRequests],
			},
		};

		// Add approval chain entry
		this.addApprovalChainEntry({
			gate: "change_request",
			decision: "rejected",
			timestamp: rejectionEvent.timestamp,
			actor: this._config.reviewer,
			reason,
			referenceId: changeRequestId,
		});
	}

	// -----------------------------------------------------------------------
	// P9.G3 — Self-Modification Approval Methods
	// -----------------------------------------------------------------------

	/**
	 * Record a self-modification approval or denial.
	 * Self-modification refers to changes to pi's own protected systems
	 * (packages/, .pi/agent/, .pi/settings.json, .pi/skills/).
	 * P9.G3 AC1: Self-modification approvals are recorded.
	 *
	 * @param approved - Whether self-modification was approved
	 * @param affectedPaths - The protected system paths affected
	 * @param reason - Reason for the approval or denial
	 */
	async recordSelfModificationApproval(
		approved: boolean,
		affectedPaths: string[],
		reason: string,
	): Promise<SelfModificationApproval> {
		const event: ApprovalEvent = {
			type: "self_modification",
			decision: approved ? "approved" : "rejected",
			timestamp: new Date().toISOString(),
			reviewer: this._config.reviewer,
			reason,
			budgetSnapshot: this.captureBudgetSnapshot(),
			proposalId: this._config.proposalId,
		};

		const record: SelfModificationApproval = {
			timestamp: event.timestamp,
			approved,
			affectedPaths,
			reason,
			event,
		};

		this._selfModificationApprovals.push(record);

		// Update approval status
		this._approvalStatus = {
			...this._approvalStatus,
			selfModification: {
				approved,
				event,
			},
		};

		// Add approval chain entry
		this.addApprovalChainEntry({
			gate: "self_modification",
			decision: approved ? "approved" : "rejected",
			timestamp: event.timestamp,
			actor: this._config.reviewer,
			reason,
			referenceId: this._config.proposalId,
		});

		// Journal a non-state-transition event for audit trail
		const action = approved ? "approved" : "rejected";
		this._journal.push({
			from: this._state,
			to: this._state as RemediationState,
			timestamp: new Date().toISOString(),
			reason: `Self-modification ${action}: ${affectedPaths.join(", ")}. Reason: ${reason}`,
		});

		return record;
	}

	/**
	 * Return to planning approval for iteration (e.g., after reviewing dry-run results).
	 *
	 * Required state: dry_run_complete, planning_approved, or execution_approved
	 */
	async revisePlan(reason?: string): Promise<void> {
		const revisableStates: RemediationState[] = ["dry_run_complete", "planning_approved", "execution_approved"];

		if (!revisableStates.includes(this._state)) {
			throw new PreconditionError(
				`Cannot revise plan: current state is ${this._state}. ` + `Allowed from: ${revisableStates.join(", ")}`,
			);
		}

		// Reset approval status for execution (planning approval remains valid)
		this._approvalStatus = {
			...this._approvalStatus,
			execution: { approved: false, rejected: false },
		};
		this._dryRunReport = undefined;

		await this.transition("planning_approval_pending", reason ?? "Returned for plan revision");
	}

	/**
	 * Reset the runtime to idle. Clears all state.
	 *
	 * Allowed from any terminal or rejected state.
	 * P9.G3: Also clears change requests, self-modification approvals,
	 * budget snapshot, and approval chain.
	 */
	async reset(): Promise<void> {
		const resetAllowed: RemediationState[] = ["complete", "failed", "planning_rejected", "execution_rejected"];

		if (!resetAllowed.includes(this._state)) {
			throw new PreconditionError(
				`Cannot reset: current state is ${this._state}. ` +
					`Reset is only allowed from terminal or rejected states: ${resetAllowed.join(", ")}`,
			);
		}

		this._scanResult = undefined;
		this._dryRunReport = undefined;
		this._error = undefined;
		this._approvalStatus = {
			planning: { approved: false, rejected: false },
			execution: { approved: false, rejected: false },
		};
		this._changeRequests = [];
		this._selfModificationApprovals = [];
		this._budgetSnapshot = undefined;
		this._approvalChain = [];

		await this.transition("idle", "Runtime reset");
	}

	// -----------------------------------------------------------------------
	// Safety Checks
	// -----------------------------------------------------------------------

	/**
	 * Check whether execution is currently allowed.
	 *
	 * Execution is allowed only when both dry-run has completed AND
	 * execution has been explicitly approved.
	 */
	get canExecute(): boolean {
		return (
			this._state === "execution_approved" &&
			this._dryRunReport !== undefined &&
			this._dryRunReport.success &&
			this._approvalStatus.execution.approved
		);
	}

	/**
	 * Get a human-readable explanation of why execution is blocked,
	 * if it is blocked.
	 *
	 * @returns Explanation string, or undefined if execution is allowed
	 */
	get executionBlockedReason(): string | undefined {
		if (this.canExecute) {
			return undefined;
		}

		if (this._state === "dry_run_complete") {
			return "Execution requires explicit approval (approveExecution) but none has been given. Dry-run is complete; call approveExecution() to proceed.";
		}

		if (this._state !== "execution_approved") {
			return `Execution requires state "execution_approved" but current state is "${this._state}".`;
		}
		if (!this._dryRunReport) {
			return "Execution requires a completed dry-run, but none has been performed.";
		}
		if (!this._dryRunReport.success) {
			return `Execution requires a successful dry-run, but the last dry-run failed: ${this._dryRunReport.error}`;
		}
		if (!this._approvalStatus.execution.approved) {
			return "Execution requires explicit approval (approveExecution), but none has been given.";
		}
		return "Execution blocked for an unknown reason.";
	}

	// -----------------------------------------------------------------------
	// Snapshot (P9.G3 extended)
	// -----------------------------------------------------------------------

	/**
	 * Take a snapshot of the current runtime state.
	 *
	 * P9.G3: Includes changeRequests, selfModificationApprovals,
	 * budgetSnapshot, and approvalChain in the snapshot.
	 */
	snapshot(): RemediationSnapshot {
		const approvalChainEntries = [...this._approvalChain];

		return {
			state: this._state,
			approvalStatus: this._approvalStatus,
			scanResult: this._scanResult,
			dryRunReport: this._dryRunReport,
			error: this._error,
			journal: [...this._journal],
			createdAt: this._createdAt,
			updatedAt: this._journal.length > 0 ? this._journal[this._journal.length - 1].timestamp : this._createdAt,
			// P9.G3 fields
			budgetSnapshot: this._budgetSnapshot,
			changeRequests: this._changeRequests.length > 0 ? [...this._changeRequests] : undefined,
			selfModificationApprovals:
				this._selfModificationApprovals.length > 0 ? [...this._selfModificationApprovals] : undefined,
			approvalChain:
				approvalChainEntries.length > 0
					? {
							entries: approvalChainEntries,
							proposalId: this._config.proposalId,
							startedAt: approvalChainEntries[0].timestamp,
							completedAt:
								this._state === "complete" || this._state === "failed"
									? approvalChainEntries[approvalChainEntries.length - 1].timestamp
									: undefined,
						}
					: undefined,
		};
	}
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a new remediation runtime instance.
 *
 * @param config - Optional configuration
 * @returns A new RemediationRuntime instance
 */
export function createRemediationRuntime(config?: RemediationRuntimeConfig): RemediationRuntime {
	return new RemediationRuntime(config);
}

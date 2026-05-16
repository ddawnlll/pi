/**
 * Patch Approval Engine - P11.I
 *
 * Manages the approval lifecycle for optimizer patches with:
 * - Deterministic graph hashing (persisted so executor uses approved graph)
 * - Invalid patch rejection with actionable reasons
 * - Approval state transition audit logging
 *
 * Acceptance Criteria Covered:
 * 2. Invalid patches are rejected with actionable reasons.
 * 3. Approved graph hash is persisted and executor uses the approved graph,
 *    not stale authored previews.
 * 4. Approval state transitions are audited.
 */

import * as crypto from "node:crypto";
import { computeBatchPlan } from "./dag-analyzer.js";
import type { OptimizationProposal } from "./dag-optimizer.js";
import {
	createDependencyPatchPlan,
	type DependencyPatchPlan,
	type DependencyPatchPreview,
	previewDependencyPatchPlan,
	simulatePatchApplication,
	validateDependencyPatchPlan,
} from "./dependency-patch.js";
import type { GovernanceLedger } from "./governance-ledger.js";
import type { ApprovedPreviewMetadata, WorkspaceQueue } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Graph Hash
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic hash for a workspace queue's dependency graph.
 *
 * The hash incorporates:
 * - Workspace IDs (sorted)
 * - Dependencies for each workspace (sorted)
 * - Workspace risk levels and capabilities (for structural equivalence)
 * - Number of workspaces
 *
 * This hash is used to verify that the executor is using the same graph
 * that was approved, not a stale authored preview.
 *
 * @param queue - The workspace queue to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function computeGraphHash(queue: WorkspaceQueue): string {
	const hash = crypto.createHash("sha256");

	// Sort workspace IDs for deterministic ordering
	const sortedIds = queue.workspaces.map((w) => w.id).sort();
	hash.update(`workspaces:${sortedIds.join(",")}`);
	hash.update(`count:${queue.workspaces.length}`);

	// Add each workspace's dependencies (sorted)
	for (const wsId of sortedIds) {
		const ws = queue.workspaces.find((w) => w.id === wsId)!;
		const sortedDeps = [...ws.dependencies].sort();
		hash.update(`dep:${wsId}:${sortedDeps.join(",")}`);
		hash.update(`risk:${wsId}:${ws.riskLevel ?? "unknown"}`);

		if (ws.capabilities?.canEdit) {
			const sortedCaps = [...ws.capabilities.canEdit].sort();
			hash.update(`caps:${wsId}:${sortedCaps.join(",")}`);
		}
	}

	return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Actionable Validation
// ---------------------------------------------------------------------------

/**
 * Enhanced validation error with actionable guidance for fixing the issue.
 */
export interface ActionableValidationError {
	/** Error type (same as DependencyPatchValidationError.type) */
	type: string;
	/** Human-readable error message describing what's wrong */
	message: string;
	/** Actionable guidance on how to fix the issue */
	actionableGuidance: string;
	/** The patch ID that caused the error (if applicable) */
	patchId?: string;
	/** The workspace ID involved (if applicable) */
	workspaceId?: string;
	/** Additional context */
	context?: Record<string, unknown>;
}

/**
 * Result of actionable validation for a dependency patch plan.
 */
export interface ActionableValidationResult {
	/** Whether the plan is valid and can be applied */
	valid: boolean;
	/** Errors with actionable guidance */
	errors: ActionableValidationError[];
	/** Warnings (non-fatal) */
	warnings: ActionableValidationError[];
	/** Patch preview (if the plan has patches) */
	preview?: DependencyPatchPreview;
}

/**
 * Validate a patch plan and return actionable guidance for each error.
 *
 * Wraps the existing validateDependencyPatchPlan and enriches
 * each error with a human-readable fix suggestion.
 *
 * @param plan - The patch plan to validate
 * @param queue - The workspace queue to validate against
 * @returns Actionable validation result
 */
export function validateWithActionableGuidance(
	plan: DependencyPatchPlan,
	queue: WorkspaceQueue,
): ActionableValidationResult {
	const validation = validateDependencyPatchPlan(plan, queue);

	const errors: ActionableValidationError[] = validation.errors.map((err) => ({
		...err,
		actionableGuidance: getActionableGuidance(err, queue),
	}));

	const warnings: ActionableValidationError[] = validation.warnings.map((err) => ({
		...err,
		actionableGuidance: getActionableGuidance(err, queue),
	}));

	const preview = plan.patches.length > 0 ? previewDependencyPatchPlan(plan, queue) : undefined;

	return {
		valid: validation.valid,
		errors,
		warnings,
		preview,
	};
}

/**
 * Generate actionable guidance for a validation error.
 */
function getActionableGuidance(
	err: { type: string; message: string; patchId?: string; workspaceId?: string; context?: Record<string, unknown> },
	_queue: WorkspaceQueue,
): string {
	switch (err.type) {
		case "workspace_not_found":
			return `Add workspace "${err.workspaceId}" to the queue or remove the patch targeting it. Use "id: ${err.workspaceId}" in the plan's workspace list.`;

		case "dependency_not_found":
			if (err.context?.dependencyId) {
				return `Add workspace "${err.context.dependencyId}" to the queue or choose a different dependency. All dependency targets must be valid workspace IDs.`;
			}
			return "Ensure all dependency IDs reference existing workspaces in the queue.";

		case "duplicate_dependency":
			return `Workspace "${err.workspaceId}" already lists this dependency. Remove the duplicate entry or check for accidental double-add.`;

		case "dependency_already_exists":
			if (err.context?.dependencyId) {
				return `Workspace "${err.workspaceId}" already depends on "${err.context.dependencyId}". Use 'remove_dependency' if you meant to change it, or skip this patch.`;
			}
			return "Remove the duplicate dependency from the patch list.";

		case "cycle_detected":
		case "cross_workspace_cycle":
			if (err.context?.cycle) {
				const cycle = (err.context.cycle as string[]).join(" -> ");
				return `Fixing the cycle: Consider removing one of the dependencies in the cycle "${cycle}". You may need to restructure the dependency graph to break the circular reference.`;
			}
			return "Review the dependency graph for circular references. Consider removing a transitive dependency or restructuring the workspace dependencies to break the cycle.";

		case "invalid_index":
			return `The reorder index is out of range. Valid indices are 0 to ${err.context?.depCount != null ? Number(err.context.depCount) - 1 : "N-1"} where N is the number of dependencies.`;

		case "empty_patch_plan":
			return "Add at least one dependency patch (add_dependency or remove_dependency) to the plan before submitting for approval.";

		case "self_dependency":
			return `A workspace cannot depend on itself. Remove the self-referencing dependency from workspace "${err.workspaceId}".`;

		default:
			return `Review the patch configuration. ${err.message}`;
	}
}

// ---------------------------------------------------------------------------
// Approval Session with Audit
// ---------------------------------------------------------------------------

/**
 * An approval action that was recorded in the audit log.
 */
export interface ApprovalAuditEntry {
	/** Timestamp (ISO 8601) */
	timestamp: string;
	/** The action taken */
	action: "approved" | "rejected" | "submitted" | "committed" | "hash_persisted";
	/** The proposal ID (if applicable) */
	proposalId?: string;
	/** The patch plan ID (if applicable) */
	planId?: string;
	/** The approval session ID */
	sessionId: string;
	/** The graph hash at the time of the action */
	graphHash: string;
	/** Human-readable summary */
	summary: string;
	/** Optional detail */
	detail?: Record<string, unknown>;
}

/**
 * State of an approval session.
 */
export type ApprovalSessionState = "active" | "all_approved" | "some_rejected" | "committed";

/**
 * An approval session for managing optimizer patch lifecycle with audit.
 */
export class PatchApprovalSession {
	private _sessionId: string;
	private _originalQueue: WorkspaceQueue;
	private _proposals: OptimizationProposal[];
	private _auditLog: ApprovalAuditEntry[] = [];
	private _state: ApprovalSessionState = "active";
	private _approvedGraphHash: string | null = null;
	private _approvedPreviewMetadata: ApprovedPreviewMetadata | null = null;

	constructor(originalQueue: WorkspaceQueue, proposals: OptimizationProposal[]) {
		this._sessionId = `approval-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		this._originalQueue = originalQueue;
		this._proposals = proposals;

		this._audit({
			action: "submitted",
			summary: `Approval session created with ${proposals.length} proposal(s)`,
			detail: {
				proposalCount: proposals.length,
				proposalIds: proposals.map((p) => p.id),
				queuePhase: originalQueue.phase,
			},
		});
	}

	// -----------------------------------------------------------------------
	// Accessors
	// -----------------------------------------------------------------------

	get sessionId(): string {
		return this._sessionId;
	}

	get state(): ApprovalSessionState {
		return this._state;
	}

	get proposals(): ReadonlyArray<OptimizationProposal> {
		return this._proposals;
	}

	get auditLog(): ReadonlyArray<ApprovalAuditEntry> {
		return this._auditLog;
	}

	get approvedGraphHash(): string | null {
		return this._approvedGraphHash;
	}

	get approvedPreviewMetadata(): ApprovedPreviewMetadata | null {
		return this._approvedPreviewMetadata;
	}

	// -----------------------------------------------------------------------
	// Proposal Actions (with audit)
	// -----------------------------------------------------------------------

	/**
	 * Approve a specific proposal and record the decision in the audit log.
	 *
	 * @param proposalId - ID of the proposal to approve
	 * @param reviewer - Optional reviewer identifier
	 * @returns The updated proposal
	 * @throws Error if proposal not found or session already committed
	 */
	approveProposal(proposalId: string, reviewer?: string): OptimizationProposal {
		this.assertNotCommitted();

		const proposal = this._proposals.find((p) => p.id === proposalId);
		if (!proposal) {
			throw new Error(`Proposal "${proposalId}" not found in session "${this._sessionId}"`);
		}

		const updated: OptimizationProposal = {
			...proposal,
			approvalStatus: "approved",
		};

		this._proposals = this._proposals.map((p) => (p.id === proposalId ? updated : p));

		this._audit({
			action: "approved",
			proposalId,
			summary: `Proposal "${proposalId}" approved${reviewer ? ` by ${reviewer}` : ""}`,
			detail: {
				kind: proposal.kind,
				reviewer,
				description: proposal.description,
			},
		});

		this._updateState();
		return updated;
	}

	/**
	 * Reject a specific proposal with a reason and record it in the audit log.
	 *
	 * @param proposalId - ID of the proposal to reject
	 * @param reason - Human-readable reason for rejection
	 * @param reviewer - Optional reviewer identifier
	 * @returns The updated proposal
	 * @throws Error if proposal not found or session already committed
	 */
	rejectProposal(proposalId: string, reason: string, reviewer?: string): OptimizationProposal {
		this.assertNotCommitted();

		const proposal = this._proposals.find((p) => p.id === proposalId);
		if (!proposal) {
			throw new Error(`Proposal "${proposalId}" not found in session "${this._sessionId}"`);
		}

		const updated: OptimizationProposal = {
			...proposal,
			approvalStatus: "rejected",
			rejectionReason: reason,
		};

		this._proposals = this._proposals.map((p) => (p.id === proposalId ? updated : p));

		this._audit({
			action: "rejected",
			proposalId,
			summary: `Proposal "${proposalId}" rejected: ${reason}`,
			detail: {
				kind: proposal.kind,
				reviewer,
				reason,
			},
		});

		this._updateState();
		return updated;
	}

	/**
	 * Get pending proposals (not yet approved or rejected).
	 */
	getPendingProposals(): OptimizationProposal[] {
		return this._proposals.filter((p) => p.approvalStatus === "pending");
	}

	/**
	 * Get approved proposals.
	 */
	getApprovedProposals(): OptimizationProposal[] {
		return this._proposals.filter((p) => p.approvalStatus === "approved");
	}

	/**
	 * Get rejected proposals with their rejection reasons.
	 */
	getRejectedProposals(): OptimizationProposal[] {
		return this._proposals.filter((p) => p.approvalStatus === "rejected");
	}

	/**
	 * Check whether the session has been fully resolved
	 * (all proposals approved or rejected).
	 */
	get allResolved(): boolean {
		return this._proposals.every((p) => p.approvalStatus !== "pending");
	}

	// -----------------------------------------------------------------------
	// Hash Persistence (AC3)
	// -----------------------------------------------------------------------

	/**
	 * Commit the approved proposals by:
	 * 1. Computing and persisting the approved graph hash
	 * 2. Generating approved preview metadata
	 * 3. Recording the commit in the audit log
	 *
	 * After committing, the session is locked and no further changes can be made.
	 * The approved graph hash can be used by the executor to verify it is using
	 * the correct graph, not a stale authored preview.
	 *
	 * @returns The approved preview metadata with hash
	 * @throws Error if there are pending unapproved proposals
	 */
	commit(): ApprovedPreviewMetadata {
		if (!this.allResolved) {
			const pending = this.getPendingProposals();
			throw new Error(
				`Cannot commit: ${pending.length} proposal(s) still pending. Resolve all proposals first.\n` +
					`Pending: ${pending.map((p) => `"${p.id}" (${p.description})`).join(", ")}`,
			);
		}

		if (this._state === "committed") {
			throw new Error(`Session "${this._sessionId}" is already committed`);
		}

		// Compute the final queue with approved changes applied
		const approvedPatches = this.getApprovedProposals()
			.filter((p) => p.kind !== "split_workspace")
			.flatMap((p) => p.patches);

		let finalQueue: WorkspaceQueue;
		if (approvedPatches.length > 0) {
			const patchPlan = createDependencyPatchPlan(approvedPatches, this._originalQueue.phase);

			// Validate before committing
			const validation = validateWithActionableGuidance(patchPlan, this._originalQueue);
			if (!validation.valid) {
				throw new Error(
					`Cannot commit: patch plan validation failed.\n${validation.errors.map((e) => `  - ${e.message}\n    Fix: ${e.actionableGuidance}`).join("\n")}`,
				);
			}

			finalQueue = simulatePatchApplication(patchPlan, this._originalQueue);
		} else {
			finalQueue = this._originalQueue;
		}

		// Compute graph hash
		const graphHash = computeGraphHash(finalQueue);
		this._approvedGraphHash = graphHash;

		// Compute batch plan for approved preview metadata
		const batchPlan = computeBatchPlan(finalQueue);
		const batchAssignment: Record<string, number> = {};
		for (const batch of batchPlan.batches) {
			for (const wsId of batch.workspaceIds) {
				batchAssignment[wsId] = batch.batchIndex;
			}
		}

		const metadata: ApprovedPreviewMetadata = {
			batchAssignment,
			batches: batchPlan.batches.map((b) => ({
				batchIndex: b.batchIndex,
				workspaceIds: [...b.workspaceIds],
				width: b.width,
			})),
			effectiveParallelism: batchPlan.effectiveParallelism,
			patchesApplied: approvedPatches.length > 0,
			approvedAt: Date.now(),
		};

		this._approvedPreviewMetadata = metadata;

		this._audit({
			action: "hash_persisted",
			summary: `Graph hash persisted: ${graphHash.substring(0, 12)}...`,
			detail: {
				graphHash,
				batches: batchPlan.totalBatches,
				effectiveParallelism: batchPlan.effectiveParallelism,
				patchesApplied: approvedPatches.length > 0,
			},
		});

		this._audit({
			action: "committed",
			summary: `Approval session committed. ${this.getApprovedProposals().length} proposal(s) applied.`,
			detail: {
				approvedCount: this.getApprovedProposals().length,
				rejectedCount: this.getRejectedProposals().length,
				graphHash,
				effectiveParallelism: batchPlan.effectiveParallelism,
				totalBatches: batchPlan.totalBatches,
			},
		});

		this._state = "committed";
		return metadata;
	}

	/**
	 * Get the final approved queue (after all approved proposals are applied).
	 * Only available after commit().
	 *
	 * @returns The final workspace queue
	 * @throws Error if not yet committed
	 */
	getApprovedQueue(): WorkspaceQueue {
		if (this._state !== "committed") {
			throw new Error("Session has not been committed yet. Call commit() first.");
		}

		const approvedPatches = this.getApprovedProposals()
			.filter((p) => p.kind !== "split_workspace")
			.flatMap((p) => p.patches);

		if (approvedPatches.length > 0) {
			const patchPlan = createDependencyPatchPlan(approvedPatches, this._originalQueue.phase);
			return simulatePatchApplication(patchPlan, this._originalQueue);
		}

		return this._originalQueue;
	}

	// -----------------------------------------------------------------------
	// Governance Ledger Integration (AC4)
	// -----------------------------------------------------------------------

	/**
	 * Export all audit entries to the governance ledger.
	 *
	 * Records each audit entry as a governance ledger entry in the
	 * "approval" category with appropriate severity.
	 *
	 * @param ledger - The governance ledger to record entries to
	 * @param planExecId - Optional plan execution ID for traceability
	 */
	recordToGovernanceLedger(ledger: GovernanceLedger, planExecId?: string): void {
		for (const entry of this._auditLog) {
			switch (entry.action) {
				case "submitted":
					ledger.recordApproval("planning", "requested", entry.summary, {
						planExecId,
						proposalId: entry.proposalId ?? this._sessionId,
						detail: entry.detail,
					});
					break;
				case "approved":
					ledger.recordApproval("planning", "approved", entry.summary, {
						planExecId,
						proposalId: entry.proposalId,
						detail: entry.detail,
					});
					break;
				case "rejected":
					ledger.recordApproval("planning", "rejected", entry.summary, {
						planExecId,
						proposalId: entry.proposalId,
						detail: entry.detail,
					});
					break;
				case "committed":
				case "hash_persisted":
					ledger.record("g3_approval_budget", "approval", "info", entry.summary, {
						planExecId,
						detail: entry.detail,
					});
					break;
			}
		}
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	private assertNotCommitted(): void {
		if (this._state === "committed") {
			throw new Error(`Session "${this._sessionId}" is already committed and cannot be modified`);
		}
	}

	private _audit(partial: Omit<ApprovalAuditEntry, "timestamp" | "sessionId" | "graphHash">): void {
		const entry: ApprovalAuditEntry = {
			...partial,
			timestamp: new Date().toISOString(),
			sessionId: this._sessionId,
			graphHash: this._approvedGraphHash ?? "not-computed",
		};
		this._auditLog.push(entry);
	}

	private _updateState(): void {
		const pending = this.getPendingProposals().length;
		const rejected = this.getRejectedProposals().length;

		if (pending === 0 && rejected === 0) {
			this._state = "all_approved";
		} else if (pending === 0 && rejected > 0) {
			this._state = "some_rejected";
		} else {
			this._state = "active";
		}
	}
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

/**
 * Create a new patch approval session for managing optimizer proposals.
 *
 * @param originalQueue - The original workspace queue
 * @param proposals - Optimization proposals generated by the optimizer
 * @returns A new PatchApprovalSession
 */
export function createPatchApprovalSession(
	originalQueue: WorkspaceQueue,
	proposals: OptimizationProposal[],
): PatchApprovalSession {
	return new PatchApprovalSession(originalQueue, proposals);
}

// ---------------------------------------------------------------------------
// Executor Hash Verification
// ---------------------------------------------------------------------------

/**
 * Verify that the executor is using the approved graph hash.
 *
 * This should be called by the executor before starting execution to ensure
 * it is using the approved dependency graph, not a stale authored preview.
 *
 * @param currentQueue - The queue the executor is about to use
 * @param approvedHash - The persisted approved graph hash
 * @returns Object with verification result
 */
export function verifyApprovedGraphHash(
	currentQueue: WorkspaceQueue,
	approvedHash: string,
): {
	valid: boolean;
	computedHash: string;
	message: string;
} {
	const computedHash = computeGraphHash(currentQueue);
	const valid = computedHash === approvedHash;

	return {
		valid,
		computedHash,
		message: valid
			? "Queue matches approved graph hash. Safe to proceed."
			: `Queue HASH MISMATCH. Expected "${approvedHash.substring(0, 12)}..." but computed "${computedHash.substring(0, 12)}...". The queue has been modified since approval. Use the approved preview metadata instead of stale authored preview.`,
	};
}

/**
 * Produce a DependencyPatch validation error that includes actionable guidance,
 * suitable for display in CLI or dashboard UI.
 *
 * @param plan - The patch plan
 * @param queue - The target queue
 * @returns Actionable validation result
 */
export function validatePatchPlanWithGuidance(
	plan: DependencyPatchPlan,
	queue: WorkspaceQueue,
): ActionableValidationResult {
	return validateWithActionableGuidance(plan, queue);
}

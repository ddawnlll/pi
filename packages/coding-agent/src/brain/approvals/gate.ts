/**
 * Approval Gate — P18.C
 *
 * Queue, process, and expire approval requests for policy decisions
 * that require user approval.
 *
 * Features:
 * - Create approval requests from PolicyContext + ProposalRiskAssessment
 * - Approve, reject, and defer approval requests
 * - Auto-expire after configurable deadline (default 24h)
 * - Persistence to disk that survives restart
 * - Query pending, approved, rejected, and expired requests
 * - Audit logging for all approval actions
 *
 * Dependencies: PolicyEngine (P18.A), AuditLedger (P18.E)
 *
 * File Scope: packages/coding-agent/src/brain/approvals/gate.ts
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AuditEntry } from "../audit/ledger.js";
import type {
	ApprovalConfig,
	ApprovalRequest,
	ApprovalStats,
	PolicyContext,
	ProposalRiskAssessment,
} from "../policy/types.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ApprovalConfig = {
	defaultDeadlineHours: 24,
	autoExpireCheckIntervalMs: 3600000, // 1 hour
	requireReasonOnRejection: true,
	maxPendingPerType: 10,
};

const DEFAULT_PERSISTENCE_PATH = ".pi/brain/approvals/requests.json";

// ---------------------------------------------------------------------------
// ApprovalGate
// ---------------------------------------------------------------------------

export class ApprovalGate {
	private config: ApprovalConfig;
	private pending: Map<string, ApprovalRequest> = new Map();
	private history: ApprovalRequest[] = [];
	private expireTimer?: ReturnType<typeof setTimeout>;
	private readonly persistencePath: string;
	private readonly auditLedger: { append(entry: AuditEntry): Promise<void> };

	constructor(
		auditLedger: { append(entry: AuditEntry): Promise<void> },
		config?: Partial<ApprovalConfig>,
		persistencePath?: string,
	) {
		this.auditLedger = auditLedger;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.persistencePath = persistencePath ?? resolve(DEFAULT_PERSISTENCE_PATH);
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Initialize the approval gate by loading persisted state and starting
	 * the expiry check timer.
	 */
	async initialize(): Promise<void> {
		await this.load();
		this.startExpiryCheck();
	}

	/**
	 * Dispose of the approval gate, stopping the expiry check timer.
	 */
	async dispose(): Promise<void> {
		this.stopExpiryCheck();
		await this.save();
	}

	// -----------------------------------------------------------------------
	// Request Creation
	// -----------------------------------------------------------------------

	/**
	 * Create a new approval request from a policy decision context and proposal
	 * risk assessment.
	 *
	 * The request is created in "pending" status with a deadline calculated
	 * from the configured default deadline hours.
	 *
	 * @param context - The policy context that triggered the approval requirement
	 * @param risk - The risk assessment for the proposed action
	 * @returns The created ApprovalRequest
	 * @throws If too many pending requests exist for this action type
	 */
	async requestApproval(context: PolicyContext, risk: ProposalRiskAssessment): Promise<ApprovalRequest> {
		const actionType = context.actionType ?? context.action;
		if (!this.canRequestAnotherApproval(actionType)) {
			throw new Error(
				`Too many pending approval requests for type "${actionType}". ` +
					`Maximum: ${this.config.maxPendingPerType}`,
			);
		}

		const now = new Date();
		const deadline = new Date(now.getTime() + this.config.defaultDeadlineHours * 60 * 60 * 1000);

		const request: ApprovalRequest = {
			id: randomUUID(),
			proposalId: context.proposalId ?? "",
			action: context.action,
			rationale: (context.metadata?.rationale as string) ?? "",
			risk,
			requestedAt: now.toISOString(),
			deadline: deadline.toISOString(),
			requestedBy: context.actor,
			status: "pending",
			policyRuleId: context.metadata?.policyRuleId as string | undefined,
			policyContext: context,
		};

		this.pending.set(request.id, request);

		await this.save();

		return request;
	}

	/**
	 * Check whether another approval request can be created for the given type.
	 *
	 * @param type - The action type to check
	 * @returns True if a new request can be created
	 */
	canRequestAnotherApproval(type: string): boolean {
		let count = 0;
		for (const req of this.pending.values()) {
			const reqType = req.policyContext.actionType ?? req.action;
			if (reqType === type) {
				count++;
				if (count >= this.config.maxPendingPerType) {
					return false;
				}
			}
		}
		return true;
	}

	// -----------------------------------------------------------------------
	// Approval Actions
	// -----------------------------------------------------------------------

	/**
	 * Approve a pending approval request.
	 *
	 * Moves the request from pending to approved status, logs an audit entry,
	 * and persists the state.
	 *
	 * @param requestId - The ID of the request to approve
	 * @param approvedBy - Who approved the request (username or system identifier)
	 * @returns The updated ApprovalRequest
	 * @throws If the request is not found or already processed
	 */
	async approve(requestId: string, approvedBy: string): Promise<ApprovalRequest> {
		const request = this.pending.get(requestId);
		if (!request) {
			throw new Error(`Approval request "${requestId}" not found or already processed`);
		}

		request.status = "approved";
		request.approvedBy = approvedBy;
		request.approvedAt = new Date().toISOString();

		this.pending.delete(requestId);
		this.history.push(request);

		// Log audit entry
		await this.auditLedger.append({
			id: randomUUID(),
			timestamp: request.approvedAt,
			actor: "user",
			action: `approve:${request.action}`,
			decision: "allow",
			policyRuleId: request.policyRuleId,
			proposalId: request.proposalId,
			approvalRequestId: request.id,
			evidence: [],
			result: "success",
			context: {
				autonomyLevel: request.policyContext.autonomyLevel,
				riskLevel: request.risk.level,
			},
			metadata: {
				approvedBy,
				rationale: request.rationale,
			},
		});

		await this.save();

		return request;
	}

	/**
	 * Reject a pending approval request.
	 *
	 * Moves the request from pending to rejected status, logs an audit entry,
	 * and persists the state. If requireReasonOnRejection is configured, a
	 * rejection reason is required.
	 *
	 * @param requestId - The ID of the request to reject
	 * @param rejectedBy - Who rejected the request
	 * @param reason - Optional reason for rejection (required if configured)
	 * @returns The updated ApprovalRequest
	 * @throws If the request is not found, already processed, or reason missing
	 */
	async reject(requestId: string, rejectedBy: string, reason?: string): Promise<ApprovalRequest> {
		const request = this.pending.get(requestId);
		if (!request) {
			throw new Error(`Approval request "${requestId}" not found or already processed`);
		}

		if (this.config.requireReasonOnRejection && !reason) {
			throw new Error("Rejection reason is required");
		}

		request.status = "rejected";
		request.rejectedBy = rejectedBy;
		request.rejectedAt = new Date().toISOString();
		request.rejectionReason = reason;

		this.pending.delete(requestId);
		this.history.push(request);

		// Log audit entry
		await this.auditLedger.append({
			id: randomUUID(),
			timestamp: request.rejectedAt,
			actor: "user",
			action: `reject:${request.action}`,
			decision: "deny",
			policyRuleId: request.policyRuleId,
			proposalId: request.proposalId,
			approvalRequestId: request.id,
			evidence: [],
			result: "blocked",
			context: {
				autonomyLevel: request.policyContext.autonomyLevel,
				riskLevel: request.risk.level,
			},
			metadata: {
				rejectedBy,
				reason: reason ?? "",
				rationale: request.rationale,
			},
		});

		await this.save();

		return request;
	}

	/**
	 * Defer a pending approval request, extending its deadline.
	 *
	 * @param requestId - The ID of the request to defer
	 * @param hours - Number of hours to extend the deadline (default: config.defaultDeadlineHours)
	 * @returns The updated ApprovalRequest
	 * @throws If the request is not found or not in pending status
	 */
	async defer(requestId: string, hours?: number): Promise<ApprovalRequest> {
		const request = this.pending.get(requestId);
		if (!request) {
			throw new Error(`Approval request "${requestId}" not found or already processed`);
		}

		if (request.status !== "pending") {
			throw new Error(`Cannot defer a ${request.status} request`);
		}

		const deferHours = hours ?? this.config.defaultDeadlineHours;
		const newDeadline = new Date(Date.now() + deferHours * 60 * 60 * 1000);
		request.deadline = newDeadline.toISOString();

		await this.save();

		return request;
	}

	// -----------------------------------------------------------------------
	// Queries
	// -----------------------------------------------------------------------

	/**
	 * Get all pending approval requests.
	 */
	getPending(): ApprovalRequest[] {
		return Array.from(this.pending.values());
	}

	/**
	 * Get all approved approval requests.
	 */
	getApproved(): ApprovalRequest[] {
		return this.history.filter((r) => r.status === "approved");
	}

	/**
	 * Get all rejected approval requests.
	 */
	getRejected(): ApprovalRequest[] {
		return this.history.filter((r) => r.status === "rejected");
	}

	/**
	 * Get all expired approval requests.
	 */
	getExpired(): ApprovalRequest[] {
		return this.history.filter((r) => r.status === "expired");
	}

	/**
	 * Get a single approval request by ID.
	 *
	 * Checks both pending and history maps.
	 *
	 * @param id - The request ID to find
	 * @returns The request or null if not found
	 */
	getById(id: string): ApprovalRequest | null {
		return this.pending.get(id) ?? this.history.find((r) => r.id === id) ?? null;
	}

	/**
	 * Get all approval requests associated with a proposal.
	 *
	 * @param proposalId - The proposal ID to search for
	 * @returns Array of matching requests
	 */
	getByProposal(proposalId: string): ApprovalRequest[] {
		const results: ApprovalRequest[] = [];

		for (const req of this.pending.values()) {
			if (req.proposalId === proposalId) {
				results.push(req);
			}
		}

		for (const req of this.history) {
			if (req.proposalId === proposalId) {
				results.push(req);
			}
		}

		return results;
	}

	// -----------------------------------------------------------------------
	// Expiry Management
	// -----------------------------------------------------------------------

	/**
	 * Start the periodic expiry check timer.
	 *
	 * Checks pending requests at the configured interval and expires those
	 * past their deadline.
	 */
	startExpiryCheck(): void {
		if (this.expireTimer) return;

		this.expireTimer = setInterval(() => {
			this.checkExpired().catch((err) => {
				console.error(`[ApprovalGate] Expiry check failed: ${err}`);
			});
		}, this.config.autoExpireCheckIntervalMs);

		// Allow the timer to not prevent process exit
		if (typeof this.expireTimer === "object" && "unref" in this.expireTimer) {
			this.expireTimer.unref();
		}
	}

	/**
	 * Stop the periodic expiry check timer.
	 */
	stopExpiryCheck(): void {
		if (this.expireTimer) {
			clearInterval(this.expireTimer);
			this.expireTimer = undefined;
		}
	}

	/**
	 * Check all pending requests for expiry.
	 *
	 * Any pending request whose deadline has passed is moved to expired status.
	 *
	 * @returns Array of newly expired requests
	 */
	async checkExpired(): Promise<ApprovalRequest[]> {
		const expired: ApprovalRequest[] = [];
		const now = Date.now();

		for (const [id, request] of this.pending) {
			if (this.isExpired(request, now)) {
				request.status = "expired";
				this.pending.delete(id);
				this.history.push(request);
				expired.push(request);
			}
		}

		if (expired.length > 0) {
			await this.save();
		}

		return expired;
	}

	/**
	 * Check whether a single request is past its deadline.
	 */
	private isExpired(request: ApprovalRequest, now?: number): boolean {
		const checkTime = now ?? Date.now();
		return request.status === "pending" && new Date(request.deadline).getTime() <= checkTime;
	}

	// -----------------------------------------------------------------------
	// Persistence
	// -----------------------------------------------------------------------

	/**
	 * Save the current state (pending + history) to disk.
	 */
	private async save(): Promise<void> {
		const data = {
			pending: Array.from(this.pending.values()),
			history: this.history,
		};

		await mkdir(dirname(this.persistencePath), { recursive: true });
		await writeFile(this.persistencePath, JSON.stringify(data, null, 2), "utf-8");
	}

	/**
	 * Load persisted state from disk.
	 *
	 * Silently returns if no persistence file exists.
	 */
	private async load(): Promise<void> {
		if (!existsSync(this.persistencePath)) return;

		try {
			const content = await readFile(this.persistencePath, "utf-8");
			const data = JSON.parse(content) as { pending: ApprovalRequest[]; history: ApprovalRequest[] };

			this.pending.clear();
			for (const req of data.pending ?? []) {
				this.pending.set(req.id, req);
			}
			this.history = data.history ?? [];
		} catch (err) {
			console.error(`[ApprovalGate] Failed to load persistence file: ${err}`);
		}
	}

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	/**
	 * Get aggregate statistics about all approval requests.
	 */
	getStats(): ApprovalStats {
		const allRequests = [...this.pending.values(), ...this.history];
		const total = allRequests.length;
		const pending = this.pending.size;
		const approved = this.history.filter((r) => r.status === "approved").length;
		const rejected = this.history.filter((r) => r.status === "rejected").length;
		const expired = this.history.filter((r) => r.status === "expired").length;

		// Compute average response time for completed requests
		const completedRequests = this.history.filter((r) => r.status !== "expired" && (r.approvedAt || r.rejectedAt));
		let avgResponseTimeMs = 0;
		if (completedRequests.length > 0) {
			const totalTime = completedRequests.reduce((sum, r) => {
				const endTime = new Date(r.approvedAt ?? r.rejectedAt!).getTime();
				const startTime = new Date(r.requestedAt).getTime();
				return sum + (endTime - startTime);
			}, 0);
			avgResponseTimeMs = totalTime / completedRequests.length;
		}

		// Pending by type
		const pendingByType: Record<string, number> = {};
		for (const req of this.pending.values()) {
			const type = req.policyContext.actionType ?? req.action;
			pendingByType[type] = (pendingByType[type] ?? 0) + 1;
		}

		return {
			total,
			pending,
			approved,
			rejected,
			expired,
			avgResponseTimeMs,
			pendingByType,
		};
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the approval gate configuration.
	 *
	 * @param config - Partial configuration to apply
	 */
	setConfig(config: Partial<ApprovalConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Get the current approval gate configuration.
	 */
	getConfig(): ApprovalConfig {
		return { ...this.config };
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an ApprovalGate instance.
 *
 * @param auditLedger - An object with an `append` method for audit logging
 * @param config - Optional configuration overrides
 * @param persistencePath - Optional path for persistence file
 * @returns ApprovalGate instance
 */
export function createApprovalGate(
	auditLedger: { append(entry: AuditEntry): Promise<void> },
	config?: Partial<ApprovalConfig>,
	persistencePath?: string,
): ApprovalGate {
	return new ApprovalGate(auditLedger, config, persistencePath);
}

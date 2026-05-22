/**
 * Approval Queue API — P18.D
 *
 * High-level API service for approval request operations.
 *
 * Wraps ApprovalGate into a unified service interface used by
 * the web-server routes. Handles business logic such as listing,
 * filtering, approve/reject/defer actions, stats, and history.
 *
 * This service is backend-agnostic: it works with any ApprovalGate
 * instance (which itself manages in-memory + file persistence).
 *
 * @packageDocumentation
 */

import type { ApprovalRequest, ApprovalStats, ApprovalStatus } from "../policy/types.js";
import type { ApprovalGate } from "./gate.js";

// ---------------------------------------------------------------------------
// API Types
// ---------------------------------------------------------------------------

/**
 * Query parameters for listing approval requests.
 */
export interface ApprovalListQuery {
	status?: ApprovalStatus | "all";
	limit?: number;
	offset?: number;
}

/**
 * Query parameters for listing approval history.
 */
export interface ApprovalHistoryQuery {
	limit?: number;
	offset?: number;
	since?: string;
	until?: string;
}

/**
 * Result of listing approval requests.
 */
export interface ApprovalListResult {
	approvals: ApprovalRequest[];
	total: number;
	stats: ApprovalStats;
}

/**
 * Result of listing approval history.
 */
export interface ApprovalHistoryResult {
	approvals: ApprovalRequest[];
	total: number;
}

/**
 * Result of an approve/reject/defer operation.
 */
export interface ApprovalActionResult {
	success: boolean;
	approval?: ApprovalRequest;
	message: string;
}

// ---------------------------------------------------------------------------
// ApprovalQueueApi
// ---------------------------------------------------------------------------

/**
 * High-level service for approval queue API operations.
 *
 * Provides methods for listing, getting, approving, rejecting, deferring
 * approval requests, plus stats and history. All methods return serializable
 * results suitable for REST API responses.
 *
 * Usage:
 * ```typescript
 * const gate = new ApprovalGate(auditLedger);
 * await gate.initialize();
 * const api = new ApprovalQueueApi(gate);
 * const result = await api.approveRequest("req-123", "user");
 * ```
 */
export class ApprovalQueueApi {
	/**
	 * @param gate - The ApprovalGate instance managing approval requests
	 */
	constructor(private gate: ApprovalGate) {}

	// -----------------------------------------------------------------------
	// List / Get
	// -----------------------------------------------------------------------

	/**
	 * List approval requests, optionally filtered by status.
	 *
	 * Returns both the filtered list and aggregate stats.
	 *
	 * @param query - Optional filter parameters
	 * @returns List result with approvals and stats
	 */
	async listApprovals(query?: ApprovalListQuery): Promise<ApprovalListResult> {
		const status = query?.status ?? "pending";
		const limit = query?.limit ?? 50;
		const offset = query?.offset ?? 0;

		let approvals: ApprovalRequest[];

		switch (status) {
			case "pending":
				approvals = this.gate.getPending();
				break;
			case "approved":
				approvals = this.gate.getApproved();
				break;
			case "rejected":
				approvals = this.gate.getRejected();
				break;
			case "expired":
				approvals = this.gate.getExpired();
				break;
			case "all": {
				// Combine pending + history
				const pending = this.gate.getPending();
				const history = [...this.gate.getApproved(), ...this.gate.getRejected(), ...this.gate.getExpired()];
				approvals = [...pending, ...history];
				break;
			}
			default:
				approvals = this.gate.getPending();
				break;
		}

		const total = approvals.length;
		const sliced = approvals.slice(offset, offset + limit);

		return {
			approvals: sliced,
			total,
			stats: this.gate.getStats(),
		};
	}

	/**
	 * Get a single approval request by ID.
	 *
	 * @param id - The request ID to find
	 * @returns The approval request, or null if not found
	 */
	async getApproval(id: string): Promise<ApprovalRequest | null> {
		return this.gate.getById(id);
	}

	// -----------------------------------------------------------------------
	// Actions
	// -----------------------------------------------------------------------

	/**
	 * Approve a pending approval request.
	 *
	 * @param requestId - The ID of the request to approve
	 * @param approvedBy - Who approved the request
	 * @returns Action result with the updated request
	 */
	async approveRequest(requestId: string, approvedBy: string): Promise<ApprovalActionResult> {
		try {
			const request = this.gate.getById(requestId);
			if (!request) {
				return {
					success: false,
					message: `Approval request "${requestId}" not found`,
				};
			}

			if (request.status !== "pending") {
				return {
					success: false,
					message: `Cannot approve a request with status "${request.status}"`,
				};
			}

			const updated = await this.gate.approve(requestId, approvedBy);
			return {
				success: true,
				approval: updated,
				message: "Approval request approved",
			};
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : "Failed to approve request",
			};
		}
	}

	/**
	 * Reject a pending approval request.
	 *
	 * @param requestId - The ID of the request to reject
	 * @param rejectedBy - Who rejected the request
	 * @param reason - Optional reason for rejection
	 * @returns Action result with the updated request
	 */
	async rejectRequest(requestId: string, rejectedBy: string, reason?: string): Promise<ApprovalActionResult> {
		try {
			const request = this.gate.getById(requestId);
			if (!request) {
				return {
					success: false,
					message: `Approval request "${requestId}" not found`,
				};
			}

			if (request.status !== "pending") {
				return {
					success: false,
					message: `Cannot reject a request with status "${request.status}"`,
				};
			}

			const updated = await this.gate.reject(requestId, rejectedBy, reason);
			return {
				success: true,
				approval: updated,
				message: reason ? `Approval request rejected: ${reason}` : "Approval request rejected",
			};
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : "Failed to reject request",
			};
		}
	}

	/**
	 * Defer a pending approval request, extending its deadline.
	 *
	 * @param requestId - The ID of the request to defer
	 * @param newDeadline - Optional ISO date string for new deadline
	 * @returns Action result with the updated request
	 */
	async deferRequest(requestId: string, newDeadline?: string): Promise<ApprovalActionResult> {
		try {
			const request = this.gate.getById(requestId);
			if (!request) {
				return {
					success: false,
					message: `Approval request "${requestId}" not found`,
				};
			}

			if (request.status !== "pending") {
				return {
					success: false,
					message: `Cannot defer a request with status "${request.status}"`,
				};
			}

			let hours: number | undefined;
			if (newDeadline) {
				const currentTime = Date.now();
				const newDeadlineMs = new Date(newDeadline).getTime();
				if (Number.isNaN(newDeadlineMs)) {
					return {
						success: false,
						message: `Invalid deadline format: "${newDeadline}". Use ISO 8601 format.`,
					};
				}
				if (newDeadlineMs <= currentTime) {
					return {
						success: false,
						message: "New deadline must be in the future",
					};
				}
				hours = (newDeadlineMs - currentTime) / (1000 * 60 * 60);
			}

			const updated = await this.gate.defer(requestId, hours);
			return {
				success: true,
				approval: updated,
				message: "Approval request deferred",
			};
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : "Failed to defer request",
			};
		}
	}

	// -----------------------------------------------------------------------
	// Stats
	// -----------------------------------------------------------------------

	/**
	 * Get approval queue statistics.
	 *
	 * @returns Current approval stats
	 */
	async getStats(): Promise<ApprovalStats> {
		return this.gate.getStats();
	}

	// -----------------------------------------------------------------------
	// History
	// -----------------------------------------------------------------------

	/**
	 * Get all completed approval requests (approved, rejected, expired).
	 *
	 * Optionally filtered by date range.
	 *
	 * @param query - Optional filter parameters
	 * @returns History result with completed approvals
	 */
	async getHistory(query?: ApprovalHistoryQuery): Promise<ApprovalHistoryResult> {
		const limit = query?.limit ?? 50;
		const offset = query?.offset ?? 0;

		const history = [...this.gate.getApproved(), ...this.gate.getRejected(), ...this.gate.getExpired()];

		// Sort by most recent first
		history.sort((a, b) => {
			const dateA = a.approvedAt ?? a.rejectedAt ?? a.requestedAt;
			const dateB = b.approvedAt ?? b.rejectedAt ?? b.requestedAt;
			return dateB.localeCompare(dateA);
		});

		// Apply date filters
		let filtered = history;
		if (query?.since) {
			const sinceMs = new Date(query.since).getTime();
			if (!Number.isNaN(sinceMs)) {
				filtered = filtered.filter((r) => {
					const date = r.approvedAt ?? r.rejectedAt ?? r.requestedAt;
					return new Date(date).getTime() >= sinceMs;
				});
			}
		}
		if (query?.until) {
			const untilMs = new Date(query.until).getTime();
			if (!Number.isNaN(untilMs)) {
				filtered = filtered.filter((r) => {
					const date = r.approvedAt ?? r.rejectedAt ?? r.requestedAt;
					return new Date(date).getTime() <= untilMs;
				});
			}
		}

		const total = filtered.length;
		const sliced = filtered.slice(offset, offset + limit);

		return {
			approvals: sliced,
			total,
		};
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an ApprovalQueueApi instance.
 *
 * @param gate - The ApprovalGate instance
 * @returns ApprovalQueueApi instance
 */
export function createApprovalQueueApi(gate: ApprovalGate): ApprovalQueueApi {
	return new ApprovalQueueApi(gate);
}

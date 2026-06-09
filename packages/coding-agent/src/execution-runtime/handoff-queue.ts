import type { Database } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";
import type { HandoffQueueRow } from "./types.js";

// =========================================================================
// Types
// =========================================================================

export type HandoffStatus = "pending" | "resolved" | "manually_resolved" | "complete" | "rejected" | "expired";

// Re-export the HandoffQueueRow type from types.ts
// export type { HandoffQueueRow } from "./types.js";

export interface HandoffTimeoutPolicy {
	/** Time in ms before a handoff expires */
	timeoutMs: number;
	/** Action to take when a handoff expires */
	onTimeout: "mark_failed_retryable" | "mark_failed_final" | "escalate_only";
}

export interface HandoffDedupeInput {
	attemptId: string;
	planExecutionId: string;
	workspaceExecutionId: string;
	reason: string;
}

const DEFAULT_HANDOFF_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

// =========================================================================
// HandoffQueue
// =========================================================================

export class HandoffQueue {
	private readonly timeoutPolicy: HandoffTimeoutPolicy;

	constructor(
		private readonly db: Kysely<Database>,
		timeoutPolicy?: Partial<HandoffTimeoutPolicy>,
	) {
		this.timeoutPolicy = {
			timeoutMs: timeoutPolicy?.timeoutMs ?? DEFAULT_HANDOFF_TIMEOUT_MS,
			onTimeout: timeoutPolicy?.onTimeout ?? "mark_failed_retryable",
		};
	}

	/**
	 * Create a required handoff entry with deduplication.
	 * If an unresolved handoff already exists for the same attempt/reason,
	 * returns the existing entry instead of creating a duplicate.
	 */
	async createRequired(
		attemptId: string,
		planExecutionId: string,
		workspaceExecutionId: string,
		reason: string,
	): Promise<{ id: string; deduped: boolean }> {
		// Dedupe: check for existing unresolved handoff with same attempt + reason
		const existing = await this.db
			.selectFrom("handoff_queue" as any)
			.selectAll()
			.where("attempt_id" as any, "=", attemptId)
			.where("reason" as any, "=", reason)
			.where("status" as any, "in", ["pending"])
			.executeTakeFirst();

		if (existing) {
			return { id: (existing as HandoffQueueRow).id, deduped: true };
		}

		const now = new Date().toISOString();
		const expiresAt = new Date(Date.now() + this.timeoutPolicy.timeoutMs).toISOString();
		const id = crypto.randomUUID();

		await this.db
			.insertInto("handoff_queue" as any)
			.values({
				id,
				attempt_id: attemptId,
				plan_execution_id: planExecutionId,
				workspace_execution_id: workspaceExecutionId,
				status: "pending",
				reason,
				required: true,
				expires_at: expiresAt,
				created_at: now,
				updated_at: now,
			})
			.execute();

		return { id, deduped: false };
	}

	/**
	 * List all unresolved handoffs.
	 */
	async listPending(planExecutionId?: string): Promise<HandoffQueueRow[]> {
		let query = this.db
			.selectFrom("handoff_queue" as any)
			.selectAll()
			.where("status" as any, "=", "pending");

		if (planExecutionId) {
			query = query.where("plan_execution_id" as any, "=", planExecutionId) as any;
		}

		return (await query.execute()) as unknown as HandoffQueueRow[];
	}

	/**
	 * Resolve a handoff.
	 */
	async resolve(handoffId: string, resolution: string): Promise<{ resolved: boolean; reason?: string }> {
		const now = new Date().toISOString();
		try {
			await this.db
				.updateTable("handoff_queue" as any)
				.set({
					status: "resolved",
					resolved_at: now,
					resolution,
					updated_at: now,
				})
				.where("id" as any, "=", handoffId)
				.where("status" as any, "=", "pending")
				.execute();
			return { resolved: true };
		} catch (error) {
			return {
				resolved: false,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Reject a handoff.
	 */
	async reject(handoffId: string, rejectionReason: string): Promise<{ rejected: boolean; reason?: string }> {
		const now = new Date().toISOString();
		try {
			await this.db
				.updateTable("handoff_queue" as any)
				.set({
					status: "rejected",
					rejected_at: now,
					rejection_reason: rejectionReason,
					updated_at: now,
				})
				.where("id" as any, "=", handoffId)
				.where("status" as any, "=", "pending")
				.execute();
			return { rejected: true };
		} catch (error) {
			return {
				rejected: false,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Expire handoffs that have exceeded their timeout.
	 * Returns a list of expired handoff IDs.
	 */
	async expireTimedOut(now?: Date): Promise<HandoffQueueRow[]> {
		const cutoff = (now ?? new Date()).toISOString();

		const expired = (await this.db
			.selectFrom("handoff_queue" as any)
			.selectAll()
			.where("status" as any, "=", "pending")
			.where("expires_at" as any, "<", cutoff)
			.execute()) as unknown as HandoffQueueRow[];

		if (expired.length === 0) return [];

		const expiredIds = expired.map((h) => h.id);

		await this.db
			.updateTable("handoff_queue" as any)
			.set({
				status: "expired",
				expired_at: cutoff,
				updated_at: cutoff,
			})
			.where("id" as any, "in", expiredIds)
			.where("status" as any, "=", "pending")
			.execute();

		return expired;
	}

	/**
	 * Get the timeout policy.
	 */
	getTimeoutPolicy(): HandoffTimeoutPolicy {
		return { ...this.timeoutPolicy };
	}
}

import type { Database } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";

/** Default lease duration when acquiring leadership for an attempt (5 min). */
const DEFAULT_LEASE_MS = 5 * 60_000;

export class ControllerLeadership {
	constructor(
		private readonly db: Kysely<Database>,
		private readonly controllerId: string,
		private readonly leaseMs: number = DEFAULT_LEASE_MS,
	) {}

	async withAttemptLock<T>(attemptId: string, fn: () => Promise<T>): Promise<T> {
		const now = new Date();

		// First check: is there an active lease owned by another controller?
		// We do this read first to avoid clobbering a live lease with our own
		// expiry via the upsert below.
		const existing = await this.db
			.selectFrom("controller_leases" as any)
			.select(["controller_id", "lease_expires_at"])
			.where("attempt_id" as any, "=", attemptId)
			.executeTakeFirst();

		if (existing) {
			const ownerId = (existing as { controller_id: string }).controller_id;
			const ownerExpiresAt = new Date((existing as { lease_expires_at: string }).lease_expires_at).getTime();
			if (ownerId !== this.controllerId && ownerExpiresAt > now.getTime()) {
				throw new Error("controller_conflict");
			}
		}

		// Acquire or extend our lease. The unique constraint on attempt_id
		// ensures only one row per attempt.
		const expiresAt = new Date(now.getTime() + this.leaseMs);
		await this.db
			.insertInto("controller_leases" as any)
			.values({
				id: crypto.randomUUID(),
				attempt_id: attemptId,
				controller_id: this.controllerId,
				lease_expires_at: expiresAt.toISOString(),
				created_at: now.toISOString(),
				updated_at: now.toISOString(),
			})
			.onConflict((oc) =>
				(oc as any).column("attempt_id").doUpdateSet({
					lease_expires_at: expiresAt.toISOString(),
					updated_at: now.toISOString(),
				}),
			)
			.execute();

		try {
			return await fn();
		} finally {
			// Release the lease: set its expiry to now so the slot becomes
			// immediately available. We only touch rows we own so a takeover
			// by another controller during fn() is preserved.
			await this.db
				.updateTable("controller_leases" as any)
				.set({ lease_expires_at: now.toISOString(), updated_at: now.toISOString() })
				.where("attempt_id" as any, "=", attemptId)
				.where("controller_id" as any, "=", this.controllerId)
				.execute();
		}
	}
}

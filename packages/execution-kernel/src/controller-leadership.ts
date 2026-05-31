import type { Database } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";

export class ControllerLeadership {
	constructor(
		private readonly db: Kysely<Database>,
		private readonly controllerId: string,
	) {}

	async withAttemptLock<T>(attemptId: string, fn: () => Promise<T>): Promise<T> {
		const lease = await this.db
			.selectFrom("controller_leases" as any)
			.selectAll()
			.where("attempt_id" as any, "=", attemptId)
			.executeTakeFirst();
		if (
			lease &&
			new Date((lease as { lease_expires_at: string }).lease_expires_at).getTime() > Date.now() &&
			(lease as { controller_id: string }).controller_id !== this.controllerId
		) {
			throw new Error("controller_conflict");
		}
		return await fn();
	}
}

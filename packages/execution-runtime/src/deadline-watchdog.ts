import type { Database } from "@earendil-works/pi-db";
import type { Kysely } from "kysely";

export class DeadlineWatchdog {
	private timer: ReturnType<typeof setInterval> | null = null;
	constructor(
		private readonly db: Kysely<Database>,
		private readonly intervalMs = 60_000,
	) {}
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.scan(), this.intervalMs);
		this.timer.unref?.();
	}
	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	}
	async scan(): Promise<void> {
		// Only consider attempts in non-terminal states — terminal attempts
		// should not be re-enqueued for deadline_exceeded even if their
		// (stale) deadline is in the past.
		const TERMINAL_STATES = new Set<string>(["SUCCEEDED", "FAILED_FINAL", "FAILED_RETRYABLE", "CANCELLED"]);
		const attempts = (await this.db
			.selectFrom("attempts" as any)
			.selectAll()
			.execute()) as unknown as Array<{
			id: string;
			plan_execution_id: string;
			workspace_execution_id: string;
			current_state: string;
			current_deadline_at: string | null;
			version: number;
		}>;
		for (const attempt of attempts) {
			if (TERMINAL_STATES.has(attempt.current_state)) continue;
			if (!attempt.current_deadline_at || new Date(attempt.current_deadline_at).getTime() >= Date.now()) continue;
			await this.db
				.insertInto("controller_inbox" as any)
				.values({
					id: crypto.randomUUID(),
					attempt_id: attempt.id,
					plan_execution_id: attempt.plan_execution_id,
					workspace_execution_id: attempt.workspace_execution_id,
					message_type: "deadline_exceeded",
					payload: { attemptId: attempt.id },
					dedupe_key: `deadline:${attempt.id}:${attempt.version}`,
					processed_at: null,
					created_at: new Date().toISOString(),
				})
				.onConflict((oc) => oc.column("dedupe_key" as any).doNothing())
				.execute();
		}
	}
}

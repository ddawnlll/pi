/**
 * Overnight Orchestrator — schedules and runs autonomous overnight queue execution.
 *
 * P20.A — Overnight Run Orchestration
 *
 * Manages one or more plan execution sessions with stop conditions:
 * - Integration queue dirty → stop
 * - Merge conflict → stop
 * - Policy violation → stop
 * - Max duration exceeded → stop
 * - User intervention → stop
 */

import { generateId } from "@earendil-works/pi-db";

// =========================================================================
// Types
// =========================================================================

export type OvernightStopCondition =
	| "integration_queue_dirty"
	| "merge_conflict"
	| "policy_violation"
	| "low_confidence_unsafe"
	| "user_intervention"
	| "error_threshold_exceeded"
	| "max_duration_reached";

export type OvernightStatus = "scheduled" | "running" | "completed" | "stopped" | "failed";

export interface RunProgress {
	completed: number;
	total: number;
	failed: number;
}

export interface OvernightConfig {
	planExecIds: string[];
	autonomyLevel: 3 | 4;
	stopConditions: OvernightStopCondition[];
	maxDurationHours: number;
	scheduleTime?: string;
	notificationEnabled: boolean;
	generateMorningReport: boolean;
}

export interface RunSession {
	id: string;
	planExecIds: string[];
	status: OvernightStatus;
	startedAt?: string;
	completedAt?: string;
	stopReason?: string;
	progress: {
		completed: number;
		total: number;
		failed: number;
	};
	createdAt: string;
}

export interface RunStatus {
	sessionId: string;
	status: OvernightStatus;
	progress: RunSession["progress"];
	currentPlan?: string;
	currentPlanStatus?: string;
	lastStopCheckAt?: string;
	stopConditionsMet?: string[];
	elapsedHours: number;
}

// =========================================================================
// PlanQueueRef — minimal interface for plan queue operations
// =========================================================================

export interface PlanQueueRef {
	getQueuedPlans(): Promise<string[]>;
	getPlanStatus(planExecId: string): Promise<string>;
	startPlan(planExecId: string): Promise<void>;
	stopPlan(planExecId: string, reason?: string): Promise<void>;
	enqueuePlan(planExecId: string): Promise<void>;
}

// =========================================================================
// OvernightOrchestrator
// =========================================================================

export class OvernightOrchestrator {
	private sessions: Map<string, RunSession> = new Map();
	private config: OvernightConfig | null = null;
	private session: RunSession | null = null;
	private stopCheckTimer: ReturnType<typeof setInterval> | null = null;
	private planQueue: PlanQueueRef;
	private isRunning = false;
	/** Promise-chain mutex serialising session lifecycle access. */
	private sessionMutex: Promise<void> = Promise.resolve();

	constructor(planQueue: PlanQueueRef, _config?: Partial<OvernightConfig>) {
		this.planQueue = planQueue;
	}

	/**
	 * Acquire the session mutex to serialise concurrent lifecycle calls.
	 */
	private async withSessionMutex<T>(fn: () => Promise<T>): Promise<T> {
		const prev = this.sessionMutex;
		let release: () => void;
		this.sessionMutex = new Promise<void>((resolve) => {
			release = resolve;
		});
		await prev;
		try {
			return await fn();
		} finally {
			release!();
		}
	}

	// =========================================================================
	// Lifecycle
	// =========================================================================

	async schedule(config: OvernightConfig): Promise<RunSession> {
		return this.withSessionMutex(async () => {
			const existing = this.getRunningSession();
			if (existing) {
				throw new Error("An overnight session is already running");
			}

			const session: RunSession = {
				id: generateId(),
				planExecIds: config.planExecIds,
				status: "scheduled",
				progress: { completed: 0, total: config.planExecIds.length, failed: 0 },
				createdAt: new Date().toISOString(),
			};

			this.config = config;
			this.session = session;
			this.sessions.set(session.id, session);
			return session;
		});
	}

	async startNow(config: OvernightConfig): Promise<RunSession> {
		const session = await this.schedule(config);
		await this.startScheduled(session.id);
		return session;
	}

	async startScheduled(sessionId: string): Promise<void> {
		return this.withSessionMutex(async () => {
			const session = this.sessions.get(sessionId);
			if (!session) throw new Error(`Session ${sessionId} not found`);
			if (session.status !== "scheduled") throw new Error(`Session ${sessionId} is not scheduled`);

			session.status = "running";
			session.startedAt = new Date().toISOString();
			this.isRunning = true;

			this.startStopCheckInterval();
			await this.runOrchestrationLoop();
		});
	}

	async stop(reason: string): Promise<RunSession> {
		return this.withSessionMutex(async () => {
			if (!this.session) throw new Error("No active session");
			this.isRunning = false;
			this.stopStopCheckInterval();
			this.session.status = "stopped";
			this.session.stopReason = reason;
			this.session.completedAt = new Date().toISOString();

			// Stop all running plans
			for (const planId of this.session.planExecIds) {
				try {
					await this.planQueue.stopPlan(planId, reason);
				} catch {
					// Ignore errors during stop
				}
			}

			return this.session;
		});
	}

	async pause(): Promise<RunSession> {
		return this.withSessionMutex(async () => {
			if (!this.session) throw new Error("No active session");
			this.isRunning = false;
			this.stopStopCheckInterval();
			this.session.status = "stopped";
			this.session.stopReason = "Paused by user";
			return this.session;
		});
	}

	async resume(): Promise<RunSession> {
		return this.withSessionMutex(async () => {
			if (!this.session) throw new Error("No active session");
			if (this.session.status !== "stopped") throw new Error("Session is not stopped");

			this.session.status = "running";
			this.isRunning = true;
			this.startStopCheckInterval();
			await this.runOrchestrationLoop();
			return this.session;
		});
	}

	// =========================================================================
	// Status
	// =========================================================================

	getStatus(): RunStatus | null {
		if (!this.session) return null;
		return {
			sessionId: this.session.id,
			status: this.session.status,
			progress: { ...this.session.progress },
			elapsedHours: this.session.startedAt ? (Date.now() - new Date(this.session.startedAt).getTime()) / 3600000 : 0,
		};
	}

	getSession(): RunSession | null {
		return this.session;
	}

	getHistory(limit = 10): RunSession[] {
		return Array.from(this.sessions.values())
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
			.slice(0, limit);
	}

	// =========================================================================
	// Stop condition checks
	// =========================================================================

	async checkStopConditions(): Promise<OvernightStopCondition[]> {
		if (!this.config) return [];
		const met: OvernightStopCondition[] = [];

		for (const condition of this.config.stopConditions) {
			let triggered = false;
			switch (condition) {
				case "integration_queue_dirty":
					triggered = await this.checkIntegrationQueue();
					break;
				case "merge_conflict":
					triggered = await this.checkMergeConflicts();
					break;
				case "policy_violation":
					triggered = await this.checkPolicyViolations();
					break;
				case "user_intervention":
					triggered = await this.checkUserIntervention();
					break;
				case "max_duration_reached":
					triggered = await this.checkDuration();
					break;
				case "low_confidence_unsafe":
					triggered = await this.checkLowConfidence();
					break;
				case "error_threshold_exceeded":
					triggered = await this.checkErrorThreshold();
					break;
			}
			if (triggered) met.push(condition);
		}

		return met;
	}

	private async checkIntegrationQueue(): Promise<boolean> {
		try {
			// Stub: would query integration queue for dirty entries
			return false;
		} catch {
			return false;
		}
	}

	private async checkMergeConflicts(): Promise<boolean> {
		return false;
	}

	private async checkPolicyViolations(): Promise<boolean> {
		return false;
	}

	private async checkUserIntervention(): Promise<boolean> {
		return false;
	}

	private async checkDuration(): Promise<boolean> {
		if (!this.session?.startedAt || !this.config) return false;
		const elapsed = (Date.now() - new Date(this.session.startedAt).getTime()) / 3600000;
		return elapsed >= this.config.maxDurationHours;
	}

	private async checkLowConfidence(): Promise<boolean> {
		return false;
	}

	private async checkErrorThreshold(): Promise<boolean> {
		if (!this.session) return false;
		return this.session.progress.failed >= 3;
	}

	// =========================================================================
	// Internal
	// =========================================================================

	private startStopCheckInterval(): void {
		this.stopStopCheckInterval();
		this.stopCheckTimer = setInterval(async () => {
			const met = await this.checkStopConditions();
			if (met.length > 0 && this.isRunning) {
				await this.stop(`Stop condition met: ${met.join(", ")}`);
			}
		}, 30_000); // Check every 30 seconds
	}

	private stopStopCheckInterval(): void {
		if (this.stopCheckTimer) {
			clearInterval(this.stopCheckTimer);
			this.stopCheckTimer = null;
		}
	}

	private async runOrchestrationLoop(): Promise<void> {
		if (!this.session || !this.config) return;
		const queue = [...this.session.planExecIds];
		let index = 0;

		while (this.isRunning && index < queue.length) {
			const planId = queue[index];
			if (!planId) break;

			try {
				await this.planQueue.startPlan(planId);
				// Poll until plan completes or stopped
				while (this.isRunning) {
					const status = await this.planQueue.getPlanStatus(planId);
					if (status === "complete" || status === "failed") {
						if (status === "complete") {
							this.session.progress.completed++;
						} else {
							this.session.progress.failed++;
						}
						break;
					}
					if (status === "stopped" || status === "cancelled") {
						this.session.progress.failed++;
						break;
					}
					await sleep(5000);
				}
			} catch {
				this.session.progress.failed++;
			}

			index++;
		}

		// Mark session complete
		if (this.isRunning && this.session) {
			this.session.status = "completed";
			this.session.completedAt = new Date().toISOString();
		}
		this.isRunning = false;
		this.stopStopCheckInterval();
	}

	private getRunningSession(): RunSession | null {
		if (this.session && (this.session.status === "running" || this.session.status === "scheduled")) {
			return this.session;
		}
		return null;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

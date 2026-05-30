/**
 * Parallelism Monitor — P38.1
 *
 * Continuously samples active worker counts during scenario execution.
 * Produces timeline data for assertion validation and reporting.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParallelismSample {
	/** Timestamp in epoch ms */
	timestampMs: number;
	/** Number of active (RUNNING) workers */
	activeWorkers: number;
	/** Number of ready-to-schedule workers */
	readyWorkers: number;
	/** Number of blocked workers */
	blockedWorkers: number;
	/** Number of completed workers */
	completedWorkers: number;
	/** Number of failed workers */
	failedWorkers: number;
}

export interface ParallelismSummary {
	/** Plan ID */
	planId: string;
	/** Execution mode */
	executionMode: string;
	/** Requested max parallelism */
	requestedMaxParallelism: number;
	/** Max observed active workers */
	maxObservedActiveWorkers: number;
	/** Average active workers over samples */
	averageActiveWorkers: number;
	/** All samples for timeline */
	samples: ParallelismSample[];
	/** Whether a parallelism regression was detected */
	parallelismRegression: boolean;
	/** Reason for serialization if detected */
	serializationReason: string | null;
}

// ---------------------------------------------------------------------------
// Parallelism Monitor
// ---------------------------------------------------------------------------

export class ParallelismMonitor {
	private samples: ParallelismSample[] = [];
	private planId: string;
	private executionMode: string;
	private requestedMax: number;
	private startTime: number;

	constructor(planId: string, executionMode: string, requestedMaxParallelism: number) {
		this.planId = planId;
		this.executionMode = executionMode;
		this.requestedMax = requestedMaxParallelism;
		this.startTime = Date.now();
	}

	/**
	 * Record a sample of the current worker pool state.
	 */
	sample(state: {
		activeWorkers: number;
		readyWorkers: number;
		blockedWorkers: number;
		completedWorkers: number;
		failedWorkers: number;
	}): void {
		this.samples.push({
			timestampMs: Date.now() - this.startTime,
			activeWorkers: state.activeWorkers,
			readyWorkers: state.readyWorkers,
			blockedWorkers: state.blockedWorkers,
			completedWorkers: state.completedWorkers,
			failedWorkers: state.failedWorkers,
		});
	}

	/**
	 * Get current active worker count.
	 */
	get currentActive(): number {
		if (this.samples.length === 0) return 0;
		return this.samples[this.samples.length - 1].activeWorkers;
	}

	/**
	 * Get max observed active workers.
	 */
	get maxObserved(): number {
		if (this.samples.length === 0) return 0;
		return Math.max(...this.samples.map((s) => s.activeWorkers));
	}

	/**
	 * Get average active workers.
	 */
	get average(): number {
		if (this.samples.length === 0) return 0;
		const total = this.samples.reduce((sum, s) => sum + s.activeWorkers, 0);
		return total / this.samples.length;
	}

	/**
	 * Get timeline of active worker counts.
	 */
	get timeline(): Array<{ timestampMs: number; active: number }> {
		return this.samples.map((s) => ({
			timestampMs: s.timestampMs,
			active: s.activeWorkers,
		}));
	}

	/**
	 * Check for parallelism regression.
	 * A regression is when actual parallelism is significantly lower than requested
	 * without a documented reason.
	 */
	detectRegression(): { regression: boolean; reason: string | null } {
		const maxObserved = this.maxObserved;

		// For stable_3: up to 3 workers
		if (this.executionMode === "stable_3") {
			if (this.requestedMax >= 3 && maxObserved < 2) {
				return {
					regression: true,
					reason: `stable_3 plan requested ${this.requestedMax} workers but only ${maxObserved} were observed active.`,
				};
			}
		}

		// For patch_transaction: at least 1 if requested > 0
		if (this.executionMode === "patch_transaction") {
			if (this.requestedMax > 0 && maxObserved === 0) {
				return {
					regression: true,
					reason: `patch_transaction plan requested ${this.requestedMax} workers but none were observed active.`,
				};
			}
		}

		return { regression: false, reason: null };
	}

	/**
	 * Produce a summary.
	 */
	summary(): ParallelismSummary {
		const regression = this.detectRegression();
		return {
			planId: this.planId,
			executionMode: this.executionMode,
			requestedMaxParallelism: this.requestedMax,
			maxObservedActiveWorkers: this.maxObserved,
			averageActiveWorkers: this.average,
			samples: this.samples,
			parallelismRegression: regression.regression,
			serializationReason: regression.reason,
		};
	}
}

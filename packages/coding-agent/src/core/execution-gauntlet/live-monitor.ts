/**
 * Live Monitor — P38.1
 *
 * Real-time monitoring of gauntlet execution. Writes structured event streams,
 * state snapshots, and journal entries to disk for post-run analysis.
 *
 * Reuses concepts from the V5 diagnostic runner but removes V5-specific
 * assumptions.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LiveMonitorEvent {
	/** Event type */
	type: string;
	/** Timestamp in epoch ms */
	timestampMs: number;
	/** Run ID */
	runId: string;
	/** Plan ID (if applicable) */
	planId?: string;
	/** Workspace ID (if applicable) */
	workspaceId?: string;
	/** Event data */
	data: Record<string, unknown>;
}

export interface LiveMonitorState {
	activeWorkers: number;
	readyWorkers: number;
	blockedWorkers: number;
	failedWorkers: number;
	completedWorkers: number;
	currentPlanId: string | null;
	currentSuite: string;
	elapsedMs: number;
	seed: number;
	currentIteration: number;
	totalIterations: number;
}

// ---------------------------------------------------------------------------
// Live Monitor
// ---------------------------------------------------------------------------

export class LiveMonitor {
	private reportDir: string;
	private eventStreamPath: string;
	private stateSnapshotsPath: string;
	private schedulerDecisionsPath: string;
	private logPath: string;
	private eventStreamFd: fs.FileHandle | null = null;
	private stateSnapshotsFd: fs.FileHandle | null = null;
	private schedulerFd: fs.FileHandle | null = null;
	private logFd: fs.FileHandle | null = null;
	private runId: string;
	private startTime: number;

	constructor(reportDir: string, runId: string) {
		this.reportDir = reportDir;
		this.runId = runId;
		this.startTime = Date.now();
		this.eventStreamPath = path.join(reportDir, "event-stream.ndjson");
		this.stateSnapshotsPath = path.join(reportDir, "state-snapshots.ndjson");
		this.schedulerDecisionsPath = path.join(reportDir, "scheduler-decisions.ndjson");
		this.logPath = path.join(reportDir, "live-monitor.log");
	}

	async open(): Promise<void> {
		await fs.mkdir(this.reportDir, { recursive: true });

		this.eventStreamFd = await fs.open(this.eventStreamPath, "a");
		this.stateSnapshotsFd = await fs.open(this.stateSnapshotsPath, "a");
		this.schedulerFd = await fs.open(this.schedulerDecisionsPath, "a");
		this.logFd = await fs.open(this.logPath, "a");

		await this.log("Live monitor started.");
	}

	async close(): Promise<void> {
		if (this.eventStreamFd) await this.eventStreamFd.close();
		if (this.stateSnapshotsFd) await this.stateSnapshotsFd.close();
		if (this.schedulerFd) await this.schedulerFd.close();
		if (this.logFd) await this.logFd.close();
	}

	private async appendLine(fd: fs.FileHandle | null, line: string): Promise<void> {
		if (!fd) return;
		await fd.appendFile(`${line}\n`);
	}

	async log(message: string): Promise<void> {
		const timestamp = new Date().toISOString();
		await this.appendLine(this.logFd, `[${timestamp}] [${this.runId}] ${message}`);
	}

	async emitEvent(event: LiveMonitorEvent): Promise<void> {
		await this.appendLine(this.eventStreamFd, JSON.stringify(event));
	}

	async writeStateSnapshot(state: LiveMonitorState): Promise<void> {
		await this.appendLine(
			this.stateSnapshotsFd,
			JSON.stringify({
				...state,
				timestampMs: Date.now() - this.startTime,
			}),
		);
	}

	async writeSchedulerDecision(decision: Record<string, unknown>): Promise<void> {
		await this.appendLine(
			this.schedulerFd,
			JSON.stringify({
				...decision,
				timestampMs: Date.now() - this.startTime,
			}),
		);
	}

	/**
	 * Heartbeat — emit a periodic heartbeat event.
	 */
	async heartbeat(state: LiveMonitorState): Promise<void> {
		await this.emitEvent({
			type: "heartbeat",
			timestampMs: Date.now() - this.startTime,
			runId: this.runId,
			data: {
				...state,
			},
		});
		await this.writeStateSnapshot(state);
	}

	/**
	 * Write workspace error visibility event.
	 */
	async workspaceError(data: {
		planId: string;
		workspaceId: string;
		errorMessage: string;
		completionGateBlockReasons: string[];
		lastCommand: string | null;
		lastCommandExitCode: number | null;
		leadDiagnosis: string | null;
	}): Promise<void> {
		await this.emitEvent({
			type: "workspace_error",
			timestampMs: Date.now() - this.startTime,
			runId: this.runId,
			planId: data.planId,
			workspaceId: data.workspaceId,
			data: {
				errorMessage: data.errorMessage,
				completionGateBlockReasons: data.completionGateBlockReasons,
				lastCommand: data.lastCommand,
				lastCommandExitCode: data.lastCommandExitCode,
				leadDiagnosis: data.leadDiagnosis,
			},
		});
	}

	/**
	 * Write plan start event.
	 */
	async planStart(planId: string, executionMode: string): Promise<void> {
		await this.emitEvent({
			type: "plan_start",
			timestampMs: Date.now() - this.startTime,
			runId: this.runId,
			planId,
			data: { executionMode },
		});
		await this.log(`Plan ${planId} started (mode: ${executionMode}).`);
	}

	/**
	 * Write plan end event.
	 */
	async planEnd(planId: string, passed: boolean, durationMs: number): Promise<void> {
		await this.emitEvent({
			type: "plan_end",
			timestampMs: Date.now() - this.startTime,
			runId: this.runId,
			planId,
			data: { passed, durationMs },
		});
		await this.log(`Plan ${planId} ended: ${passed ? "PASS" : "FAIL"} (${durationMs}ms).`);
	}

	/**
	 * Write suite start event.
	 */
	async suiteStart(suite: string): Promise<void> {
		await this.log(`Suite ${suite} started.`);
	}

	/**
	 * Write suite end event.
	 */
	async suiteEnd(suite: string, passed: number, failed: number): Promise<void> {
		await this.log(`Suite ${suite} ended: ${passed} passed, ${failed} failed.`);
	}

	/**
	 * Write iteration start event (for Monte Carlo).
	 */
	async iterationStart(iteration: number, total: number): Promise<void> {
		await this.emitEvent({
			type: "iteration_start",
			timestampMs: Date.now() - this.startTime,
			runId: this.runId,
			data: { iteration, total },
		});
	}

	/**
	 * Write iteration end event.
	 */
	async iterationEnd(iteration: number, passed: boolean): Promise<void> {
		await this.emitEvent({
			type: "iteration_end",
			timestampMs: Date.now() - this.startTime,
			runId: this.runId,
			data: { iteration, passed },
		});
	}
}

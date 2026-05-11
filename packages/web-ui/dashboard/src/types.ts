/**
 * Plan Dashboard Types
 * Matches the data structures from .pi/ directory
 */

export interface PlanState {
	title: string;
	phase: string;
	status: "running" | "paused" | "stopped" | "completed" | "failed";
	elapsed: number;
	queue: {
		pending: number;
		active: number;
		blocked: number;
		complete: number;
		failed: number;
	};
	workers: WorkerInfo[];
	startedAt?: string;
}

export interface WorkerInfo {
	id: string;
	stage: "pending" | "active" | "blocked" | "complete" | "failed";
	attempt: number;
	retries: number;
	snapshotPath?: string;
	reportPath?: string;
}

export interface ExecutionEvent {
	timestamp: string;
	type: "started" | "completed" | "failed" | "retry" | "blocked";
	workspaceId: string;
	message: string;
}

export interface ControlRequest {
	action: "pause" | "stop" | "cancel" | "resume";
	requestedAt: string;
	requestedBy: string;
}

export interface ControlResponse {
	success: boolean;
	error?: string;
}

export type LogStream = "stdout" | "stderr" | "test" | "error";

/**
 * Task Store — persistence for MultiPhaseTask under .pi/tasks/
 *
 * Provides CRUD for tasks, phase lifecycle updates, timeline I/O,
 * aggregate computation, and listing.
 *
 * File layout:
 *   .pi/tasks/<taskId>/
 *     task.json         # MultiPhaseTask (full state)
 *     timeline.ndjson   # Append-only JSON-Lines timeline events
 */

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types (server-side source of truth; frontend types.ts mirrors these)
// ---------------------------------------------------------------------------

export type TaskStatus =
	| "draft"
	| "validating"
	| "validation_failed"
	| "approval_required"
	| "approved"
	| "queued"
	| "blocked"
	| "running"
	| "paused"
	| "complete"
	| "failed"
	| "cancelled"
	| "reflecting"
	| "reflected";

export type PhaseStatus = "pending" | "validating" | "running" | "complete" | "failed" | "skipped";

export type TaskOriginType = "user_upload" | "proposal_accepted" | "plan_factory" | "overnight_bundle" | "manual";

export interface TaskOrigin {
	type: TaskOriginType;
	sourcePlanFiles: string[];
	proposalId?: string;
	decisionId?: string;
	goalIds?: string[];
	evidenceRefs?: string[];
}

export interface TaskApprovalState {
	required: boolean;
	status: "not_required" | "pending" | "approved" | "rejected" | "revoked";
	approvedBy?: string;
	approvedAt?: number;
	approvalRequestId?: string;
	reason?: string;
}

export interface TaskPolicySnapshot {
	policyVersion: string;
	autonomyLevel: 1 | 2 | 3 | 4;
	allowedActions: string[];
	forbiddenActions: string[];
	stopConditions: string[];
}

export interface PhaseTransitionGateResult {
	allowed: boolean;
	reason?: string;
	blockedBy?: string;
	details?: Record<string, unknown>;
}

export interface TaskReflectionSummary {
	achieved: string;
	learnings: string[];
	issues: string[];
	qualityScore?: number;
	suggestedNextActions: string[];
}

export interface TaskAggregate {
	totalPhases: number;
	completedPhases: number;
	failedPhases: number;
	totalWorkspaces: number;
	completedWorkspaces: number;
	totalTokensIn: number;
	totalTokensOut: number;
	totalCostUsd: number;
	totalDurationMs: number;
}

export interface PhaseExecutionResult {
	planExecId: string;
	status: string;
	startedAt: number;
	completedAt: number | null;
	durationMs: number | null;
	workspaces: Array<{ id: string; stage: string; error: string | null }>;
	stats: {
		total: number;
		complete: number;
		failed: number;
		total_tokens_in?: number;
		total_tokens_out?: number;
		estimated_cost_usd?: number;
	};
	error: string | null;
}

export interface PhasePlan {
	id: string;
	title: string;
	status: PhaseStatus;
	planFile: string;
	dependsOn: string[];
	execution: PhaseExecutionResult | null;
	requiresFreshApproval?: boolean;
}

export interface MultiPhaseTask {
	id: string;
	projectId: string;
	title: string;
	status: TaskStatus;
	executionMode: "sequential" | "parallel";
	createdAt: number;
	startedAt: number | null;
	completedAt: number | null;
	origin: TaskOrigin;
	approval: TaskApprovalState;
	policy: TaskPolicySnapshot;
	phases: PhasePlan[];
	aggregate: TaskAggregate;
	reflection: TaskReflectionSummary | null;
}

export interface TimelineEvent {
	timestamp: number;
	type: string;
	data?: Record<string, unknown>;
}

export interface TaskQueueEntry {
	id: string;
	projectId: string;
	taskId: string;
	priority: number;
	status: "queued" | "blocked" | "running" | "complete" | "cancelled";
	blockedReason?: string;
	approvedBy?: string;
	approvedAt?: number;
	stopConditions: string[];
	createdAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
	return `tsk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Resolve the .pi/tasks/<taskId> directory for a workspace root.
 */
function taskDir(workspaceRoot: string, taskId: string): string {
	return join(workspaceRoot, ".pi", "tasks", taskId);
}

/**
 * Path to task.json.
 */
function taskJsonPath(workspaceRoot: string, taskId: string): string {
	return join(taskDir(workspaceRoot, taskId), "task.json");
}

/**
 * Path to timeline.ndjson.
 */
function timelinePath(workspaceRoot: string, taskId: string): string {
	return join(taskDir(workspaceRoot, taskId), "timeline.ndjson");
}

// ---------------------------------------------------------------------------
// Default factory
// ---------------------------------------------------------------------------

function defaultPolicySnapshot(): TaskPolicySnapshot {
	return {
		policyVersion: "1.0.0",
		autonomyLevel: 3,
		allowedActions: ["edit", "create", "delete", "test", "install", "commit"],
		forbiddenActions: ["self_modify_runtime", "modify_policy", "access_secrets"],
		stopConditions: ["budget_exceeded", "dirty_integration_queue", "policy_changed"],
	};
}

function defaultApprovalState(required: boolean): TaskApprovalState {
	return {
		required,
		status: required ? "pending" : "not_required",
	};
}

function emptyAggregate(): TaskAggregate {
	return {
		totalPhases: 0,
		completedPhases: 0,
		failedPhases: 0,
		totalWorkspaces: 0,
		completedWorkspaces: 0,
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCostUsd: 0,
		totalDurationMs: 0,
	};
}

// ---------------------------------------------------------------------------
// Task Store API
// ---------------------------------------------------------------------------

export interface TaskStore {
	/**
	 * Find a task and phase that contains the given plan execution ID.
	 * Returns null if no task/phase references this planExecId.
	 */
	findByPlanExecId(
		workspaceRoot: string,
		planExecId: string,
	): Promise<{ task: MultiPhaseTask; phase: PhasePlan } | null>;
	createTask(
		projectId: string,
		workspaceRoot: string,
		params: {
			title: string;
			planFiles: string[];
			executionMode: "sequential" | "parallel";
			origin: TaskOrigin;
			phases: Array<{
				id: string;
				title: string;
				planFile: string;
				dependsOn?: string[];
			}>;
		},
	): Promise<MultiPhaseTask>;

	loadTask(workspaceRoot: string, taskId: string): Promise<MultiPhaseTask | null>;
	saveTask(workspaceRoot: string, task: MultiPhaseTask): Promise<void>;
	listTasks(workspaceRoot: string, projectId: string): Promise<MultiPhaseTask[]>;
	deleteTask(workspaceRoot: string, taskId: string): Promise<void>;

	appendTimelineEvent(workspaceRoot: string, taskId: string, event: TimelineEvent): Promise<void>;
	loadTimeline(workspaceRoot: string, taskId: string): Promise<TimelineEvent[]>;

	updatePhaseStatus(
		workspaceRoot: string,
		taskId: string,
		phaseId: string,
		status: PhaseStatus,
		executionResult?: PhaseExecutionResult | null,
	): Promise<void>;

	computeAggregate(task: MultiPhaseTask): TaskAggregate;

	updateTaskStatus(workspaceRoot: string, taskId: string, status: TaskStatus): Promise<MultiPhaseTask | null>;
}

/**
 * Create a new TaskStore instance.
 */
export function createTaskStore(): TaskStore {
	/**
	 * Ensure the task directory exists.
	 */
	async function ensureTaskDir(workspaceRoot: string, taskId: string): Promise<void> {
		await mkdir(taskDir(workspaceRoot, taskId), { recursive: true });
	}

	/**
	 * Read task.json, return null on any I/O error.
	 */
	async function readTask(workspaceRoot: string, taskId: string): Promise<MultiPhaseTask | null> {
		try {
			const raw = await readFile(taskJsonPath(workspaceRoot, taskId), "utf-8");
			return JSON.parse(raw) as MultiPhaseTask;
		} catch {
			return null;
		}
	}

	const store: TaskStore = {
		async createTask(projectId, workspaceRoot, params) {
			const taskId = generateId();
			const now = Date.now();

			const task: MultiPhaseTask = {
				id: taskId,
				projectId,
				title: params.title,
				status: "draft",
				executionMode: params.executionMode,
				createdAt: now,
				startedAt: null,
				completedAt: null,
				origin: params.origin,
				approval: defaultApprovalState(false),
				policy: defaultPolicySnapshot(),
				phases: params.phases.map((p, i) => ({
					id: p.id,
					title: p.title,
					status: i === 0 ? ("pending" as PhaseStatus) : "pending",
					planFile: p.planFile,
					dependsOn: p.dependsOn ?? [],
					execution: null,
				})),
				aggregate: emptyAggregate(),
				reflection: null,
			};

			// Compute aggregate from phases
			task.aggregate = store.computeAggregate(task);

			// Persist
			await ensureTaskDir(workspaceRoot, taskId);
			await writeFile(taskJsonPath(workspaceRoot, taskId), JSON.stringify(task, null, 2), "utf-8");

			// Initial timeline event
			await store.appendTimelineEvent(workspaceRoot, taskId, {
				timestamp: now,
				type: "task_created",
				data: { title: params.title, phaseCount: params.phases.length },
			});

			return task;
		},

		loadTask: readTask,

		async saveTask(workspaceRoot, task) {
			await ensureTaskDir(workspaceRoot, task.id);
			await writeFile(taskJsonPath(workspaceRoot, task.id), JSON.stringify(task, null, 2), "utf-8");
		},

		async listTasks(workspaceRoot, projectId) {
			const tasksDir = join(workspaceRoot, ".pi", "tasks");
			let entries: string[];
			try {
				entries = await readdir(tasksDir);
			} catch {
				return [];
			}

			const results: MultiPhaseTask[] = [];
			for (const entry of entries) {
				const taskPath = join(tasksDir, entry, "task.json");
				try {
					const raw = await readFile(taskPath, "utf-8");
					const task = JSON.parse(raw) as MultiPhaseTask;
					if (task.projectId === projectId) {
						results.push(task);
					}
				} catch {
					// Skip malformed entries
				}
			}

			// Sort by createdAt descending
			results.sort((a, b) => b.createdAt - a.createdAt);
			return results;
		},

		async deleteTask(workspaceRoot, taskId) {
			const dir = taskDir(workspaceRoot, taskId);
			try {
				await unlink(taskJsonPath(workspaceRoot, taskId));
				await unlink(timelinePath(workspaceRoot, taskId));
			} catch {
				// Best effort
			}
			// Try to remove the directory (fails if not empty, which is fine)
			try {
				await readdir(dir).then(async (files) => {
					if (files.length === 0) {
						await unlink(dir).catch(() => {});
					}
				});
			} catch {
				// Best effort
			}
		},

		async appendTimelineEvent(workspaceRoot, taskId, event) {
			await ensureTaskDir(workspaceRoot, taskId);
			const line = `${JSON.stringify(event)}\n`;
			await writeFile(timelinePath(workspaceRoot, taskId), line, { flag: "a" });
		},

		async loadTimeline(workspaceRoot, taskId) {
			try {
				const raw = await readFile(timelinePath(workspaceRoot, taskId), "utf-8");
				const events: TimelineEvent[] = [];
				for (const line of raw.trim().split("\n")) {
					if (line) {
						try {
							events.push(JSON.parse(line) as TimelineEvent);
						} catch {
							// Skip malformed lines
						}
					}
				}
				return events;
			} catch {
				return [];
			}
		},

		async updatePhaseStatus(workspaceRoot, taskId, phaseId, status, executionResult) {
			const task = await readTask(workspaceRoot, taskId);
			if (!task) throw new Error(`Task ${taskId} not found`);

			const phase = task.phases.find((p) => p.id === phaseId);
			if (!phase) throw new Error(`Phase ${phaseId} not found in task ${taskId}`);

			phase.status = status;
			if (executionResult !== undefined) {
				phase.execution = executionResult;
			}

			// Recompute aggregate
			task.aggregate = store.computeAggregate(task);

			await writeFile(taskJsonPath(workspaceRoot, taskId), JSON.stringify(task, null, 2), "utf-8");
		},

		computeAggregate(task: MultiPhaseTask): TaskAggregate {
			const agg = emptyAggregate();
			agg.totalPhases = task.phases.length;

			for (const phase of task.phases) {
				if (phase.status === "complete") agg.completedPhases++;
				if (phase.status === "failed") agg.failedPhases++;

				if (phase.execution) {
					agg.totalWorkspaces += phase.execution.stats.total ?? 0;
					agg.completedWorkspaces += phase.execution.stats.complete ?? 0;
					agg.totalTokensIn += phase.execution.stats.total_tokens_in ?? 0;
					agg.totalTokensOut += phase.execution.stats.total_tokens_out ?? 0;
					agg.totalCostUsd += phase.execution.stats.estimated_cost_usd ?? 0;

					if (phase.execution.durationMs) {
						agg.totalDurationMs += phase.execution.durationMs;
					}
				}
			}

			return agg;
		},

		async updateTaskStatus(workspaceRoot, taskId, status) {
			const task = await readTask(workspaceRoot, taskId);
			if (!task) return null;

			const now = Date.now();
			task.status = status;

			if (status === "running" && !task.startedAt) {
				task.startedAt = now;
			}
			if (status === "complete" || status === "failed" || status === "cancelled" || status === "reflected") {
				task.completedAt = now;
			}

			await writeFile(taskJsonPath(workspaceRoot, taskId), JSON.stringify(task, null, 2), "utf-8");

			await store.appendTimelineEvent(workspaceRoot, taskId, {
				timestamp: now,
				type: `task_${status}`,
				data: { previousStatus: task.status },
			});

			return task;
		},

		async findByPlanExecId(workspaceRoot, planExecId) {
			const tasksDir = join(workspaceRoot, ".pi", "tasks");
			let entries: string[];
			try {
				entries = await readdir(tasksDir);
			} catch {
				return null;
			}

			for (const entry of entries) {
				try {
					const raw = await readFile(taskJsonPath(workspaceRoot, entry), "utf-8");
					const task = JSON.parse(raw) as MultiPhaseTask;
					const phase = task.phases.find((p) => p.execution?.planExecId === planExecId);
					if (phase) {
						return { task, phase };
					}
				} catch {
					// Skip malformed
				}
			}
			return null;
		},
	};

	return store;
}

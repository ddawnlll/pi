/**
 * DAG Builder — 25.N
 *
 * Builds Directed Acyclic Graphs (DAGs) for execution plans.
 * Provides PlanTask type used by the Plan Synthesizer Worker.
 */

import { createHash, randomUUID } from "node:crypto";

export type PlanTaskPriority = "critical" | "high" | "normal" | "low" | "medium";

export const ALL_PLAN_TASK_PRIORITIES: readonly PlanTaskPriority[] = [
	"critical",
	"high",
	"normal",
	"low",
	"medium",
] as const;

export type PlanTaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export const ALL_PLAN_TASK_STATUSES: readonly PlanTaskStatus[] = [
	"pending",
	"in_progress",
	"completed",
	"failed",
	"skipped",
] as const;

export interface PlanTask {
	id: string;
	title: string;
	description: string;
	status: PlanTaskStatus;
	priority: PlanTaskPriority;
	estimatedEffort: number;
	dependencyIds: string[];
	tags: string[];
	assignedWorker?: string;
	metadata: Record<string, unknown>;
	createdAt: string;
}

export interface DagEdge {
	from: string;
	to: string;
}

export interface DagValidationResult {
	valid: boolean;
	hasCycle: boolean;
	allReachable: boolean;
	topologicalOrder: string[];
	errors: string[];
	warnings: string[];
}

export class DagBuilder {
	private tasks: Map<string, PlanTask> = new Map();
	private edges: DagEdge[] = [];

	/**
	 * Add a task to the DAG.
	 *
	 * @param title - Task title.
	 * @param description - Task description.
	 * @param priority - Task priority (default: "normal").
	 * @param effort - Estimated effort (default: 1).
	 * @param dependencyIds - Array of task IDs this task depends on (default: []).
	 * @param tags - Optional tags (default: []).
	 * @returns The created PlanTask.
	 */
	addTask(
		title: string,
		description: string,
		priority: PlanTaskPriority = "normal",
		effort: number = 1,
		dependencyIds: string[] = [],
		tags: string[] = [],
	): PlanTask {
		const id = randomUUID();
		const task: PlanTask = {
			id,
			title,
			description,
			status: "pending",
			priority,
			estimatedEffort: effort,
			dependencyIds,
			tags,
			metadata: {},
			createdAt: new Date().toISOString(),
		};
		this.tasks.set(id, task);
		for (const dep of dependencyIds) {
			this.edges.push({ from: dep, to: id });
		}
		return task;
	}

	/**
	 * Add a pre-built task to the DAG.
	 */
	addPrebuiltTask(task: PlanTask): void {
		this.tasks.set(task.id, task);
		for (const dep of task.dependencyIds) {
			this.edges.push({ from: dep, to: task.id });
		}
	}

	/**
	 * Remove a task from the DAG by ID.
	 * Also removes edges referencing the removed task.
	 */
	removeTask(taskId: string): void {
		this.tasks.delete(taskId);
		this.edges = this.edges.filter((e) => e.from !== taskId && e.to !== taskId);
		for (const task of this.tasks.values()) {
			task.dependencyIds = task.dependencyIds.filter((id) => id !== taskId);
		}
	}

	getTask(taskId: string): PlanTask | undefined {
		return this.tasks.get(taskId);
	}

	getAllTasks(): PlanTask[] {
		return Array.from(this.tasks.values());
	}

	get size(): number {
		return this.tasks.size;
	}

	clear(): void {
		this.tasks.clear();
		this.edges = [];
	}

	toJSON(): { tasks: PlanTask[]; edges: DagEdge[] } {
		return { tasks: this.getAllTasks(), edges: [...this.edges] };
	}

	computeHash(): string {
		return createHash("sha256").update(JSON.stringify(this.toJSON())).digest("hex");
	}

	/**
	 * Validate the DAG for cycles, unreachable tasks, and unresolved dependencies.
	 */
	validate(): DagValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];

		if (this.tasks.size === 0) {
			return {
				valid: false,
				hasCycle: false,
				allReachable: true,
				topologicalOrder: [],
				errors: ["DAG is empty: no tasks defined"],
				warnings: [],
			};
		}

		// Check for unresolved dependencies
		for (const task of this.tasks.values()) {
			for (const depId of task.dependencyIds) {
				if (!this.tasks.has(depId)) {
					errors.push(`Task "${task.id}" depends on non-existent task "${depId}"`);
				}
			}
		}

		// Check for cycles using DFS
		const visited = new Set<string>();
		const recursionStack = new Set<string>();
		let hasCycle = false;

		const dfs = (nodeId: string): void => {
			if (recursionStack.has(nodeId)) {
				hasCycle = true;
				return;
			}
			if (visited.has(nodeId)) return;

			visited.add(nodeId);
			recursionStack.add(nodeId);

			const task = this.tasks.get(nodeId);
			if (task) {
				for (const depId of task.dependencyIds) {
					dfs(depId);
				}
			}

			recursionStack.delete(nodeId);
		};

		for (const taskId of this.tasks.keys()) {
			if (!visited.has(taskId)) {
				dfs(taskId);
			}
		}

		if (hasCycle) {
			errors.push("Circular dependency detected in DAG");
		}

		// Compute topological order (Kahn's algorithm)
		const topologicalOrder: string[] = [];
		const inDegree = new Map<string, number>();
		const adj = new Map<string, string[]>();

		for (const task of this.tasks.values()) {
			inDegree.set(task.id, 0);
			adj.set(task.id, []);
		}

		for (const edge of this.edges) {
			const neighbors = adj.get(edge.from) ?? [];
			neighbors.push(edge.to);
			adj.set(edge.from, neighbors);
			inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
		}

		const queue: string[] = [];
		for (const [id, degree] of inDegree) {
			if (degree === 0) queue.push(id);
		}

		while (queue.length > 0) {
			const node = queue.shift()!;
			topologicalOrder.push(node);
			for (const neighbor of adj.get(node) ?? []) {
				const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
				inDegree.set(neighbor, newDegree);
				if (newDegree === 0) queue.push(neighbor);
			}
		}

		// Check if all tasks are reachable
		const allReachable = topologicalOrder.length === this.tasks.size;
		if (!allReachable && !hasCycle) {
			warnings.push(
				`Not all tasks are reachable: ${topologicalOrder.length} of ${this.tasks.size} tasks in topological order`,
			);
		}

		return {
			valid: errors.length === 0,
			hasCycle,
			allReachable,
			topologicalOrder,
			errors,
			warnings,
		};
	}

	/**
	 * Get the critical path (longest chain by estimatedEffort).
	 */
	getCriticalPath(): string[] {
		if (this.tasks.size === 0) return [];

		const result = this.validate();
		if (!result.valid || result.hasCycle) return [];

		const order = result.topologicalOrder;

		const dist = new Map<string, number>();
		const prev = new Map<string, string | null>();

		for (const id of order) {
			dist.set(id, 0);
			prev.set(id, null);
		}

		for (const id of order) {
			const task = this.tasks.get(id);
			if (!task) continue;
			for (const depId of task.dependencyIds) {
				const depTask = this.tasks.get(depId);
				if (!depTask) continue;
				const newDist = (dist.get(depId) ?? 0) + depTask.estimatedEffort;
				if (newDist > (dist.get(id) ?? 0)) {
					dist.set(id, newDist);
					prev.set(id, depId);
				}
			}
		}

		let maxDist = -1;
		let maxNode: string | null = null;
		for (const [id, d] of dist) {
			if (d > maxDist) {
				maxDist = d;
				maxNode = id;
			}
		}

		const path: string[] = [];
		let current = maxNode;
		while (current !== null) {
			path.unshift(current);
			current = prev.get(current) ?? null;
		}

		return path;
	}

	/**
	 * Get the total estimated effort across all tasks.
	 */
	getTotalEffort(): number {
		let total = 0;
		for (const task of this.tasks.values()) {
			total += task.estimatedEffort;
		}
		return total;
	}
}

export function createDagBuilder(): DagBuilder {
	return new DagBuilder();
}

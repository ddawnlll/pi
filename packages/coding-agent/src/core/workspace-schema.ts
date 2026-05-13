/**
 * Workspace Schema & Validation - P2 Workstream 7.B
 *
 * Defines normalized workspace schema, validation logic, and state machine.
 */

import type { TokenRole } from "@earendil-works/pi-agent-core";
import type { RetryPolicy } from "./retry-handler.js";

/**
 * Workspace execution stage (state machine)
 */
export enum WorkspaceStage {
	/** Workspace is waiting for dependencies */
	Pending = "pending",
	/** Workspace is currently being executed */
	Active = "active",
	/** Workspace completed successfully */
	Complete = "complete",
	/** Workspace is blocked (dependencies failed or file conflicts) */
	Blocked = "blocked",
	/** Workspace execution failed */
	Failed = "failed",
}

/**
 * Workspace capability manifest
 *
 * Defines file boundaries for workspace execution to prevent
 * unintended modifications and enable safe parallelism.
 */
export interface WorkspaceCapabilityManifest {
	/** Files this workspace can read and edit */
	canEdit: string[];
	/** Files this workspace must not edit (read-only or forbidden) */
	cannotEdit: string[];
	/** Commands this workspace can run */
	canRun: string[];
	/** Commands this workspace must not run */
	cannotRun: string[];
}

/**
 * Normalized workspace specification
 *
 * This is the canonical workspace format used throughout P2 execution.
 */
export interface Workspace {
	/** Unique workspace identifier (e.g., "7.A") */
	id: string;
	/** Human-readable title */
	title: string;
	/** Workspace IDs this workspace depends on */
	dependencies: string[];
	/** Role budget for this workspace */
	roleBudget: TokenRole;
	/** Maximum retry attempts for failures */
	maxRetries: number;
	/** Retry policy with escalation thresholds (overrides defaults) */
	retryPolicy?: RetryPolicy;
	/** Risk level (affects parallelism decisions) */
	riskLevel?: "low" | "medium" | "high";
	/** Capability manifest (file/command boundaries) */
	capabilities?: WorkspaceCapabilityManifest;
	/** Acceptance criteria (optional, for validation) */
	acceptanceCriteria?: string[];
	/** Target command to run after completion (optional) */
	targetCommand?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
	/**
	 * Auto-commit on completion.
	 * If false, no git commits are made for this workspace.
	 * Defaults to true if unspecified.
	 */
	autoCommit?: boolean;
}

/**
 * Workspace queue (collection of workspaces)
 */
export interface WorkspaceQueue {
	/** Phase identifier (e.g., "P2") */
	phase: string;
	/** Phase title */
	title: string;
	/** Maximum parallel workspaces */
	maxParallelWorkspaces: number;
	/** Workspaces in execution order */
	workspaces: Workspace[];
	/**
	 * Enable post-plan handoff dialog.
	 * When true (default), plan enters awaiting_handoff state after all workspaces complete
	 * and waits for user to commit, keep editing, or discard.
	 * When false, plan auto-commits without handoff dialog.
	 */
	postPlanHandoff?: boolean;
}

/**
 * Validation error
 */
export interface ValidationError {
	/** Error type */
	type: "duplicate_id" | "invalid_dependency" | "cycle" | "invalid_role" | "missing_field";
	/** Error message */
	message: string;
	/** Workspace ID (if applicable) */
	workspaceId?: string;
	/** Additional context */
	context?: Record<string, unknown>;
}

/**
 * Validation result
 */
export interface ValidationResult {
	/** Whether validation passed */
	valid: boolean;
	/** Validation errors (if any) */
	errors: ValidationError[];
	/** Warnings (non-fatal issues) */
	warnings: ValidationError[];
}

/**
 * Validate workspace queue
 *
 * Checks for:
 * - Duplicate workspace IDs
 * - Invalid dependency references
 * - Dependency cycles
 * - Invalid role budgets
 * - Missing required fields
 *
 * @param queue - Workspace queue to validate
 * @returns Validation result
 */
export function validateWorkspaceQueue(queue: WorkspaceQueue): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationError[] = [];

	// Check for duplicate IDs
	const idSet = new Set<string>();
	for (const workspace of queue.workspaces) {
		if (idSet.has(workspace.id)) {
			errors.push({
				type: "duplicate_id",
				message: `Duplicate workspace ID: ${workspace.id}`,
				workspaceId: workspace.id,
			});
		}
		idSet.add(workspace.id);
	}

	// Check for invalid dependencies
	for (const workspace of queue.workspaces) {
		for (const dep of workspace.dependencies) {
			if (!idSet.has(dep)) {
				errors.push({
					type: "invalid_dependency",
					message: `Workspace ${workspace.id} depends on non-existent workspace: ${dep}`,
					workspaceId: workspace.id,
					context: { dependency: dep },
				});
			}
		}
	}

	// Check for cycles
	const cycleResult = detectCycles(queue.workspaces);
	if (cycleResult.hasCycle) {
		errors.push({
			type: "cycle",
			message: `Dependency cycle detected: ${cycleResult.cycle?.join(" → ")}`,
			context: { cycle: cycleResult.cycle },
		});
	}

	// Check for invalid role budgets
	const validRoles: TokenRole[] = ["flash", "worker", "lead", "reviewer", "debug", "unknown"];
	for (const workspace of queue.workspaces) {
		if (!validRoles.includes(workspace.roleBudget)) {
			errors.push({
				type: "invalid_role",
				message: `Workspace ${workspace.id} has invalid role budget: ${workspace.roleBudget}`,
				workspaceId: workspace.id,
				context: { role: workspace.roleBudget },
			});
		}
	}

	// Check for missing required fields
	for (const workspace of queue.workspaces) {
		if (!workspace.id) {
			errors.push({
				type: "missing_field",
				message: "Workspace missing required field: id",
				context: { workspace },
			});
		}
		if (!workspace.title) {
			errors.push({
				type: "missing_field",
				message: `Workspace ${workspace.id} missing required field: title`,
				workspaceId: workspace.id,
			});
		}
	}

	// Warnings for high-risk workspaces
	for (const workspace of queue.workspaces) {
		if (workspace.riskLevel === "high" && workspace.dependencies.length === 0) {
			warnings.push({
				type: "invalid_dependency",
				message: `High-risk workspace ${workspace.id} has no dependencies (may want to serialize)`,
				workspaceId: workspace.id,
			});
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Detect cycles in workspace dependencies
 *
 * Uses depth-first search to detect cycles in the dependency graph.
 *
 * @param workspaces - Workspaces to check
 * @returns Cycle detection result
 */
export function detectCycles(workspaces: Workspace[]): { hasCycle: boolean; cycle?: string[] } {
	const graph = new Map<string, string[]>();
	for (const workspace of workspaces) {
		graph.set(workspace.id, workspace.dependencies);
	}

	const visited = new Set<string>();
	const recursionStack = new Set<string>();
	const path: string[] = [];

	function dfs(nodeId: string): boolean {
		visited.add(nodeId);
		recursionStack.add(nodeId);
		path.push(nodeId);

		const neighbors = graph.get(nodeId) || [];
		for (const neighbor of neighbors) {
			if (!visited.has(neighbor)) {
				if (dfs(neighbor)) {
					return true;
				}
			} else if (recursionStack.has(neighbor)) {
				// Cycle detected
				const cycleStart = path.indexOf(neighbor);
				const cycle = path.slice(cycleStart);
				cycle.push(neighbor); // Complete the cycle
				return true;
			}
		}

		recursionStack.delete(nodeId);
		path.pop();
		return false;
	}

	for (const workspace of workspaces) {
		if (!visited.has(workspace.id)) {
			if (dfs(workspace.id)) {
				return { hasCycle: true, cycle: path.slice() };
			}
		}
	}

	return { hasCycle: false };
}

/**
 * Build dependency graph
 *
 * Creates an adjacency list representation of workspace dependencies.
 *
 * @param workspaces - Workspaces to build graph from
 * @returns Dependency graph (workspace ID -> dependent workspace IDs)
 */
export function buildDependencyGraph(workspaces: Workspace[]): Map<string, string[]> {
	const graph = new Map<string, string[]>();

	// Initialize graph
	for (const workspace of workspaces) {
		graph.set(workspace.id, []);
	}

	// Build reverse dependency graph (who depends on me?)
	for (const workspace of workspaces) {
		for (const dep of workspace.dependencies) {
			const dependents = graph.get(dep);
			if (dependents) {
				dependents.push(workspace.id);
			}
		}
	}

	return graph;
}

/**
 * Get workspaces with no dependencies (entry points)
 *
 * @param workspaces - Workspaces to check
 * @returns Workspaces with no dependencies
 */
export function getEntryWorkspaces(workspaces: Workspace[]): Workspace[] {
	return workspaces.filter((w) => w.dependencies.length === 0);
}

/**
 * Check if workspace capabilities allow editing a file
 *
 * @param capabilities - Workspace capabilities
 * @param filePath - File path to check
 * @returns True if workspace can edit the file
 */
export function canEditFile(capabilities: WorkspaceCapabilityManifest | undefined, filePath: string): boolean {
	if (!capabilities) {
		return true; // No restrictions
	}

	// Check if explicitly forbidden
	if (capabilities.cannotEdit.some((pattern) => matchesPattern(filePath, pattern))) {
		return false;
	}

	// Check if explicitly allowed
	if (capabilities.canEdit.length > 0) {
		return capabilities.canEdit.some((pattern) => matchesPattern(filePath, pattern));
	}

	// No explicit restrictions
	return true;
}

/**
 * Check if workspace capabilities allow running a command
 *
 * @param capabilities - Workspace capabilities
 * @param command - Command to check
 * @returns True if workspace can run the command
 */
export function canRunCommand(capabilities: WorkspaceCapabilityManifest | undefined, command: string): boolean {
	if (!capabilities) {
		return true; // No restrictions
	}

	// Check if explicitly forbidden
	if (capabilities.cannotRun.some((pattern) => matchesPattern(command, pattern))) {
		return false;
	}

	// Check if explicitly allowed
	if (capabilities.canRun.length > 0) {
		return capabilities.canRun.some((pattern) => matchesPattern(command, pattern));
	}

	// No explicit restrictions
	return true;
}

/**
 * Simple pattern matching (supports wildcards)
 *
 * @param value - Value to match
 * @param pattern - Pattern (supports * wildcard)
 * @returns True if value matches pattern
 */
function matchesPattern(value: string, pattern: string): boolean {
	// Convert glob pattern to regex
	const regexPattern = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
		.replace(/\*/g, ".*"); // Convert * to .*

	const regex = new RegExp(`^${regexPattern}$`);
	return regex.test(value);
}

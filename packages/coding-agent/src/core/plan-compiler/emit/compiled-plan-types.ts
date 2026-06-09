/**
 * CompiledPlan Types
 *
 * The canonical output artifact of the plan compiler.
 * Contains all derived execution data in a ready-to-execute form.
 */

import type { PlanLock, WorkerPacketV5 } from "../../planlock-types.js";

// =============================================================================
// Compiled Plan
// =============================================================================

export interface CompiledPlan {
	planSpecVersion: "5.0.0-alpha2";
	kind: "ImplementationPlan";

	phaseId: string;
	title: string;
	description: string;
	owner: string;
	status: string;
	createdAt: string;
	updatedAt: string;
	tags: string[];

	goal: string;
	successCriteria: string[];
	outOfScope: string[];

	execution: CompiledExecution;
	completion: CompiledCompletion;
	commandPolicy: CompiledCommandPolicy;
	filePolicy: CompiledFilePolicy;

	waves: CompiledWave[];
	workspaces: CompiledWorkspace[];
	tasks: CompiledTask[];

	waveGraph: Record<string, string[]>;
	workspaceGraph: Record<string, string[]>;
	taskGraph: Record<string, string[]>;

	executionBatches: ExecutionBatch[];

	workerPackets: WorkerPacketV5[];
	planLock: PlanLock;

	diagnosticSummary: {
		info: number;
		warning: number;
		error: number;
		fatal: number;
	};
}

// =============================================================================
// Sub-types
// =============================================================================

export interface CompiledExecution {
	mode: string;
	maxParallelWorkspaces: number;
	scaleMode?: string;
	worktreeIsolation: boolean;
	integrationQueue: boolean;
	validationLock: boolean;
}

export interface CompiledCompletion {
	requiresAcceptanceCriteria: boolean;
	requiresValidationEvidence: boolean;
	requiresReport: boolean;
	requiresRollbackPlan: boolean;
	requiresFinalVerdict: boolean;
}

export interface CompiledCommandPolicy {
	policy: "strict" | "moderate" | "permissive";
	allowedCommands: string[];
	blockedCommands: string[];
	timeoutSeconds?: number;
	maxOutputBytes?: number;
}

export interface CompiledFilePolicy {
	protectedPaths: string[];
	allowListedFiles: string[];
	requireExplicitApproval: boolean;
}

export interface CompiledWave {
	id: string;
	title: string;
	description: string;
	order: number;
	taskIds: string[];
	dependencies: string[];
}

export interface CompiledWorkspace {
	id: string;
	name: string;
	rootDir: string;
	canEdit: string[];
	canRead: string[];
	isolationLevel?: "full" | "partial" | "none";
}

export interface CompiledTask {
	id: string;
	title: string;
	description: string;
	type: string;
	workspaceId?: string;
	dependencies: string[];
	acceptanceCriteria: string[];
	priority: "low" | "medium" | "high" | "critical";
	executionPolicy?: {
		mode: string;
		allowedCommands: string[];
		timeoutSeconds?: number;
		maxRetries?: number;
	};
	validation?: {
		preCheck: string[];
		postCheck: string[];
		requiresHumanApproval: boolean;
	};
}

export interface ExecutionBatch {
	waveId: string;
	taskIds: string[];
	parallel: boolean;
}

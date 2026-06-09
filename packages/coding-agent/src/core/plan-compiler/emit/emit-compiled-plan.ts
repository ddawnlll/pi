/**
 * Emit CompiledPlan Artifact
 *
 * Transforms a validated PlanSpecV5Alpha2 into a CompiledPlan ready for execution.
 * Includes topological ordering, execution batches, and diagnostic summary.
 */

import type { PlanSpecV5Alpha2 } from "../alpha2/alpha2-types.js";
import type { PlanDiagnostic } from "../diagnostics/diagnostic.js";
import { summarizeDiagnostics } from "../diagnostics/format-diagnostics.js";
import type {
	CompiledPlan,
	CompiledTask,
	CompiledWave,
	CompiledWorkspace,
	ExecutionBatch,
} from "./compiled-plan-types.js";

// =============================================================================
// Main entry
// =============================================================================

/**
 * Emit a CompiledPlan from a validated Alpha2 spec.
 */
export function emitCompiledPlan(spec: PlanSpecV5Alpha2, allDiagnostics: PlanDiagnostic[]): CompiledPlan {
	// Topological sort of waves
	const sortedWaves = topologicalSortWaves(spec);

	// Build compiled waves, workspaces, tasks
	const compiledWaves: CompiledWave[] = sortedWaves.map((wave) => ({
		id: wave.id,
		title: wave.title,
		description: wave.description,
		order: wave.order,
		taskIds: wave.tasks.map((t) => t.id),
		dependencies: wave.dependencies ?? [],
	}));

	const compiledWorkspaces: CompiledWorkspace[] = spec.workspaces.map((ws) => ({
		id: ws.id,
		name: ws.name,
		rootDir: ws.rootDir,
		canEdit: ws.canEdit,
		canRead: ws.canRead ?? [],
		isolationLevel: ws.isolationLevel,
	}));

	const allTasks = spec.waves.flatMap((w) => w.tasks);
	const compiledTasks: CompiledTask[] = allTasks.map((t) => ({
		id: t.id,
		title: t.title,
		description: t.description,
		type: t.type,
		workspaceId: t.workspaceId,
		dependencies: t.dependencies ?? [],
		acceptanceCriteria: t.acceptanceCriteria,
		priority: t.priority,
		executionPolicy: t.executionPolicy
			? {
					mode: t.executionPolicy.mode ?? "moderate",
					allowedCommands: t.executionPolicy.allowedCommands ?? [],
					timeoutSeconds: t.executionPolicy.timeoutSeconds,
					maxRetries: t.executionPolicy.maxRetries,
				}
			: undefined,
		validation: t.validation
			? {
					preCheck: t.validation.preCheck ?? [],
					postCheck: t.validation.postCheck ?? [],
					requiresHumanApproval: t.validation.requiresHumanApproval ?? false,
				}
			: undefined,
	}));

	// Build graphs
	const waveGraph: Record<string, string[]> = {};
	for (const wave of compiledWaves) {
		waveGraph[wave.id] = wave.dependencies;
	}

	const workspaceGraph: Record<string, string[]> = {};
	for (const ws of compiledWorkspaces) {
		workspaceGraph[ws.id] = [];
	}

	const taskGraph: Record<string, string[]> = {};
	for (const task of compiledTasks) {
		taskGraph[task.id] = task.dependencies;
	}

	// Execution batches (simple wave-order batches)
	const executionBatches = buildExecutionBatches(compiledWaves, compiledTasks, taskGraph);

	// Diagnostic summary
	const effectiveDiagnostics = allDiagnostics.filter(
		(d) => d.severity === "error" || d.severity === "fatal" || d.severity === "warning" || d.severity === "info",
	);

	return {
		planSpecVersion: "5.0.0-alpha2",
		kind: "ImplementationPlan",

		phaseId: spec.metadata.phaseId,
		title: spec.metadata.title,
		description: spec.metadata.description,
		owner: spec.metadata.owner,
		status: spec.metadata.status,
		createdAt: spec.metadata.createdAt,
		updatedAt: spec.metadata.updatedAt,
		tags: spec.metadata.tags ?? [],

		goal: spec.intent.goal,
		successCriteria: spec.intent.successCriteria,
		outOfScope: spec.intent.outOfScope,

		execution: {
			mode: spec.authority.executionState.mode,
			maxParallelWorkspaces: spec.authority.executionState.maxParallelWorkspaces,
			scaleMode: spec.authority.executionState.scaleMode,
			worktreeIsolation: spec.authority.executionState.worktreeIsolation ?? true,
			integrationQueue: spec.authority.executionState.integrationQueue ?? false,
			validationLock: spec.authority.executionState.validationLock ?? false,
		},

		completion: {
			requiresAcceptanceCriteria: spec.authority.completion.requiresAcceptanceCriteria,
			requiresValidationEvidence: spec.authority.completion.requiresValidationEvidence,
			requiresReport: spec.authority.completion.requiresReport,
			requiresRollbackPlan: spec.authority.completion.requiresRollbackPlan,
			requiresFinalVerdict: spec.authority.completion.requiresFinalVerdict,
		},

		commandPolicy: {
			policy: spec.commands?.policy ?? "moderate",
			allowedCommands: spec.commands?.allowedCommands ?? [],
			blockedCommands: spec.commands?.blockedCommands ?? [],
			timeoutSeconds: spec.commands?.timeoutSeconds,
			maxOutputBytes: spec.commands?.maxOutputBytes,
		},

		filePolicy: {
			protectedPaths: spec.security.selfModificationFirewall.protectedPaths,
			allowListedFiles: spec.security.selfModificationFirewall.allowListedFiles ?? [],
			requireExplicitApproval: spec.security.selfModificationFirewall.requireExplicitApproval,
		},

		waves: compiledWaves,
		workspaces: compiledWorkspaces,
		tasks: compiledTasks,

		waveGraph,
		workspaceGraph,
		taskGraph,

		executionBatches,

		workerPackets: [], // Filled later by emit-worker-packets
		planLock: undefined!, // Filled later by emit-plan-lock

		diagnosticSummary: summarizeDiagnostics(effectiveDiagnostics),
	};
}

// =============================================================================
// Topological sort of waves
// =============================================================================

function topologicalSortWaves(spec: PlanSpecV5Alpha2): typeof spec.waves {
	const adj = new Map<string, string[]>();
	const inDegree = new Map<string, number>();
	const waveMap = new Map<string, (typeof spec.waves)[number]>();

	for (const wave of spec.waves) {
		waveMap.set(wave.id, wave);
		inDegree.set(wave.id, 0);
		adj.set(wave.id, []);
	}

	for (const wave of spec.waves) {
		for (const dep of wave.dependencies ?? []) {
			if (adj.has(dep)) {
				adj.get(dep)!.push(wave.id);
				inDegree.set(wave.id, (inDegree.get(wave.id) ?? 0) + 1);
			}
		}
	}

	const queue: string[] = [];
	for (const [id, degree] of inDegree) {
		if (degree === 0) queue.push(id);
	}

	const result: typeof spec.waves = [];
	while (queue.length > 0) {
		const id = queue.shift()!;
		result.push(waveMap.get(id)!);
		for (const neighbor of adj.get(id) ?? []) {
			const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
			inDegree.set(neighbor, newDegree);
			if (newDegree === 0) queue.push(neighbor);
		}
	}

	return result;
}

// =============================================================================
// Execution batches
// =============================================================================

function buildExecutionBatches(
	waves: CompiledWave[],
	tasks: CompiledTask[],
	_taskGraph: Record<string, string[]>,
): ExecutionBatch[] {
	const batches: ExecutionBatch[] = [];

	// Group tasks by wave order
	for (const wave of waves) {
		const waveTasks = tasks.filter((t) => wave.taskIds.includes(t.id));
		if (waveTasks.length > 0) {
			batches.push({
				waveId: wave.id,
				taskIds: waveTasks.map((t) => t.id),
				parallel: waveTasks.length <= 3, // Simple heuristic
			});
		}
	}

	return batches;
}

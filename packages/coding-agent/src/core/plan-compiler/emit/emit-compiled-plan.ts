/**
 * Emit CompiledPlan Artifact
 *
 * Transforms a validated PlanSpecV5Alpha2 into a CompiledPlan ready for execution.
 * Includes topological ordering, execution batches, and diagnostic summary.
 *
 * The new PlanSpec v5 Alpha2 uses a wave -> workspace model (waves reference
 * workspaceIds), rather than the old wave -> task model. Tasks are synthesized
 * from workspace acceptance criteria for backward compatibility with the
 * execution runtime.
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
	// In the new schema, waves have workspaceIds (not tasks).
	// Synthesize tasks from workspace data for runtime compatibility.
	const compiledWaves: CompiledWave[] = sortedWaves.map((wave, wi) => ({
		id: wave.id,
		title: wave.title,
		description: wave.description,
		order: wi,
		taskIds: (wave.workspaceIds ?? []).map((wsId) => `task_${wsId}`),
		dependencies: wave.dependencies ?? [],
		batchSize: wave.batchSize ?? 3,
	}));

	const compiledWorkspaces: CompiledWorkspace[] = spec.workspaces.map((ws) => ({
		id: ws.id,
		name: ws.title,
		rootDir: ".",
		canEdit: ws.allowedFiles ?? [],
		canRead: [],
		isolationLevel: "full" as const,
	}));

	// Synthesize tasks from workspace data
	const compiledTasks: CompiledTask[] = spec.workspaces.map((ws) => {
		const acTexts = (Array.isArray(ws.acceptanceCriteria) ? ws.acceptanceCriteria : []).map((ac: unknown) =>
			typeof ac === "string"
				? ac
				: ((ac as Record<string, unknown>).text ?? (ac as Record<string, unknown>).title ?? String(ac)),
		) as string[];

		const instTexts = (Array.isArray(ws.instructions) ? ws.instructions : []).map((inst: unknown) =>
			typeof inst === "string"
				? inst
				: ((inst as Record<string, unknown>).text ?? (inst as Record<string, unknown>).title ?? String(inst)),
		) as string[];

		return {
			id: `task_${ws.id}`,
			title: ws.title,
			description: instTexts.join("; ") || ws.title,
			type: "implementation" as const,
			workspaceId: ws.id,
			dependencies: ws.dependencies ?? [],
			acceptanceCriteria: acTexts,
			priority: "high" as const,
		};
	});

	// Build graphs
	const waveGraph: Record<string, string[]> = {};
	for (const wave of compiledWaves) {
		waveGraph[wave.id] = wave.dependencies;
	}

	const workspaceGraph: Record<string, string[]> = {};
	for (const ws of spec.workspaces) {
		workspaceGraph[ws.id] = ws.dependencies ?? [];
	}

	const taskGraph: Record<string, string[]> = {};
	for (const task of compiledTasks) {
		taskGraph[task.id] = task.dependencies;
	}

	// Execution batches (simple wave-order batches)
	const executionBatches = buildExecutionBatches(compiledWaves, compiledTasks, taskGraph);

	// Extract report protocol from reports section
	const reportProtocol = spec.reports?.protocol ?? "ACCP";

	// Diagnostic summary
	const effectiveDiagnostics = allDiagnostics.filter(
		(d) => d.severity === "error" || d.severity === "fatal" || d.severity === "warning" || d.severity === "info",
	);

	return {
		planSpecVersion: "5.0.0-alpha2",
		kind: "ImplementationPlan",

		phaseId: spec.metadata.phaseId,
		title: spec.metadata.title,
		description: spec.metadata.description ?? "",
		owner: spec.metadata.owner ?? "pi",
		status: spec.metadata.status,
		createdAt: spec.metadata.createdAt,
		updatedAt: spec.metadata.updatedAt ?? spec.metadata.createdAt,
		tags: [],

		goal: spec.intent.executionClass,
		successCriteria: spec.intent.safetyLevel
			? [`Safety: ${spec.intent.safetyLevel}`, `Mode: ${spec.intent.executionMode}`]
			: [],
		outOfScope: [],

		execution: {
			mode: spec.intent.executionMode,
			maxParallelWorkspaces: spec.intent.parallelism ?? 3,
			scaleMode: spec.intent.targetPromotionMode,
			worktreeIsolation: true,
			integrationQueue: false,
			validationLock: false,
		},

		completion: {
			requiresAcceptanceCriteria:
				(spec.authority.completion as Record<string, unknown>).evidenceLedgerRequired === true,
			requiresValidationEvidence:
				(spec.authority.completion as Record<string, unknown>).missingEvidenceBlocksCompletion === true,
			requiresReport: true,
			requiresRollbackPlan: false,
			requiresFinalVerdict:
				(spec.authority.completion as Record<string, unknown>).accpGateVerdictRequiredWhenModeRequired === true,
		},

		commandPolicy: {
			policy: (reportProtocol === "ACCP" ? "strict" : "moderate") as "strict" | "moderate" | "permissive",
			allowedCommands: [],
			blockedCommands: [],
			timeoutSeconds: 900,
			maxOutputBytes: 1_000_000,
		},

		filePolicy: {
			protectedPaths: spec.security.forbiddenFiles ?? [],
			allowListedFiles: [],
			requireExplicitApproval: spec.security.schemaValidationRequired ?? true,
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

	for (const wave of waves) {
		const waveTaskIds = new Set(wave.taskIds);
		const waveTasks = tasks.filter((t) => waveTaskIds.has(t.id));
		const waveTaskMap = new Map(waveTasks.map((t) => [t.id, t]));

		if (waveTaskIds.size === 0) continue;

		// Build sub-graph for this wave's tasks (only intra-wave deps)
		const inDegree = new Map<string, number>();
		const adj = new Map<string, string[]>();
		for (const t of waveTasks) {
			inDegree.set(t.id, 0);
			adj.set(t.id, []);
		}
		for (const t of waveTasks) {
			for (const dep of t.dependencies) {
				// Only count deps that are within this wave
				if (waveTaskMap.has(dep)) {
					adj.get(dep)!.push(t.id);
					inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
				}
			}
		}

		// Topological sort into levels
		const ready = new Set(waveTasks.filter((t) => inDegree.get(t.id) === 0).map((t) => t.id));
		const batchSize = wave.batchSize ?? 3;
		let subBatch = 0;

		while (ready.size > 0) {
			// Take up to batchSize tasks from the ready set
			const batchIds: string[] = [];
			for (const id of ready) {
				if (batchIds.length >= batchSize) break;
				batchIds.push(id);
			}

			for (const id of batchIds) {
				ready.delete(id);
				// Propagate: reduce in-degree of dependents
				for (const dep of adj.get(id) ?? []) {
					const newDegree = (inDegree.get(dep) ?? 1) - 1;
					inDegree.set(dep, newDegree);
					if (newDegree === 0) {
						ready.add(dep);
					}
				}
			}

			batches.push({
				waveId: `${wave.id}_s${subBatch}`,
				taskIds: batchIds,
				parallel: batchIds.length > 1,
			});
			subBatch++;
		}

		// Check for unprocessed tasks (cycles)
		const remaining = waveTasks.filter((t) => !batches.some((b) => b.taskIds.includes(t.id)));
		if (remaining.length > 0) {
			// Put remaining in one serial batch
			batches.push({
				waveId: `${wave.id}_s${subBatch}`,
				taskIds: remaining.map((t) => t.id),
				parallel: false,
			});
		}
	}

	return batches;
}

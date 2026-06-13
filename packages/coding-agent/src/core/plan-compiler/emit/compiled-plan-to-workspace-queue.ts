/**
 * CompiledPlan to WorkspaceQueue Adapter — TEMPORARY MIGRATION BRIDGE
 *
 * Converts a CompiledPlan to the legacy WorkspaceQueue format.
 * This adapter exists only to support the transition from the old
 * parser-based architecture to the compiled plan runtime.
 *
 * TODO: Remove this adapter once the runtime directly consumes CompiledPlan.
 */

import type { Workspace, WorkspaceQueue } from "../../workspace-schema.js";
import type { CompiledPlan } from "./compiled-plan-types.js";

/**
 * Convert a CompiledPlan to the legacy WorkspaceQueue format.
 * This is a temporary migration adapter.
 */
export function compiledPlanToWorkspaceQueue(plan: CompiledPlan): WorkspaceQueue {
	const workspaces: Workspace[] = plan.workspaces.map((ws) => {
		// Find tasks assigned to this workspace
		const wsTasks = plan.tasks.filter((t) => t.workspaceId === ws.id);

		const capabilities = {
			canEdit: ws.canEdit,
			cannotEdit: plan.filePolicy.protectedPaths,
			canRun: plan.commandPolicy.allowedCommands,
		};

		const instructions = wsTasks.map((t) => `**${t.title}**\n${t.description}`).join("\n\n") || ws.name;

		return {
			id: ws.id,
			title: ws.name,
			dependencies: plan.tasks.filter((t) => t.workspaceId === ws.id).flatMap((t) => t.dependencies),
			roleBudget: "worker" as const,
			executorPrompt: instructions,
			instructions,
			description: wsTasks.map((t) => t.description).join(". ") || ws.name,
			capabilities,
			maxRetries: wsTasks[0]?.executionPolicy?.maxRetries ?? 3,
			commands: plan.commandPolicy.allowedCommands,
			fileScope: {
				writeSet: ws.canEdit,
				allowedPaths: [...ws.canEdit, ...ws.canRead],
			},
			skip: false,
		};
	});

	return {
		phase: plan.phaseId,
		title: plan.title,
		maxParallelWorkspaces: plan.execution.maxParallelWorkspaces,
		workspaces,
		postPlanHandoff: true,
		executionAutomation: undefined,
	};
}

/**
 * Emit Worker Packets
 *
 * Derives WorkerPacketV5 instances from a CompiledPlan.
 * Each workspace gets a scoped execution packet with its relevant data.
 */

import type { WorkerPacketV5 } from "../../planlock-types.js";
import type { CompiledPlan } from "./compiled-plan-types.js";

// =============================================================================
// Main entry
// =============================================================================

export function emitWorkerPackets(plan: CompiledPlan, planLockHash: string): WorkerPacketV5[] {
	const packets: WorkerPacketV5[] = [];

	for (const ws of plan.workspaces) {
		// Find tasks for this workspace
		const wsTasks = plan.tasks.filter((t) => t.workspaceId === ws.id);
		const allAcceptanceCriteria = wsTasks.flatMap((t) => t.acceptanceCriteria);
		const allAllowedFiles = [...ws.canEdit, ...ws.canRead];

		// Build command scope from task execution policies
		const commandScope: Record<string, string> = {};
		for (const task of wsTasks) {
			if (task.executionPolicy?.allowedCommands) {
				for (const cmd of task.executionPolicy.allowedCommands) {
					commandScope[cmd] = cmd;
				}
			}
		}
		// Also include top-level allowed commands
		for (const cmd of plan.commandPolicy.allowedCommands) {
			if (!(cmd in commandScope)) {
				commandScope[cmd] = cmd;
			}
		}

		const validationRefs = wsTasks.flatMap((t) => [
			...(t.validation?.preCheck ?? []),
			...(t.validation?.postCheck ?? []),
		]);

		packets.push({
			accpVersion: "1.2",
			planLockHash,
			workspaceLockHash: `${planLockHash}#${ws.id}`,
			repoBaseSha: "unknown", // Will be set at runtime
			workspaceId: ws.id,
			workspaceTitle: ws.name,
			description: `${ws.name} — ${wsTasks.map((t) => t.title).join(", ")}`,
			allowedFiles: allAllowedFiles,
			forbiddenFiles: plan.filePolicy.protectedPaths,
			acceptanceCriteria: [...new Set(allAcceptanceCriteria)],
			validationRefs,
			finalValidationRefs: plan.completion.requiresFinalVerdict ? validationRefs : [],
			commandScope,
			requiredReports: [],
			completionEchoRequired: plan.completion.requiresReport,
			dependencies: [], // Workspace-level dependencies not defined in Alpha2
		});
	}

	return packets;
}

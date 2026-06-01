/**
 * Execution Command Handler — P40 Platform / Agent Separation
 *
 * Facade for processing execution commands.
 * External consumers (Brain, Web, CLI) send commands through this handler.
 * Only Execution may transition state.
 */
import type { ExecutionCommand } from "@earendil-works/pi-execution-core";

export interface CommandHandlerResult {
	accepted: boolean;
	message: string;
	error?: string;
}

export async function handleExecutionCommand(
	command: ExecutionCommand,
	deps: {
		planControlManager?: {
			writeControlRequest(action: string, reason?: string): Promise<void>;
		};
		transitionRouter?: {
			transitionWorkspace(
				planExecutionId: string,
				workspaceId: string,
				stage: string,
				metadata?: Record<string, unknown>,
			): Promise<void>;
		};
	},
): Promise<CommandHandlerResult> {
	switch (command.type) {
		case "start_plan":
			return { accepted: true, message: `Plan ${command.planId} start requested.` };
		case "stop_plan":
			if (!deps.planControlManager)
				return {
					accepted: false,
					message: "Plan control manager not available",
					error: "No plan control manager configured",
				};
			await deps.planControlManager.writeControlRequest("stop", command.reason);
			return {
				accepted: true,
				message: `Stop request sent for plan ${command.planExecutionId}`,
			};
		case "continue_plan":
			if (!deps.planControlManager)
				return {
					accepted: false,
					message: "Plan control manager not available",
					error: "No plan control manager configured",
				};
			await deps.planControlManager.writeControlRequest("resume", command.reason);
			return {
				accepted: true,
				message: `Continue request sent for plan ${command.planExecutionId}`,
			};
		case "rerun_plan":
			if (!deps.planControlManager)
				return {
					accepted: false,
					message: "Plan control manager not available",
					error: "No plan control manager configured",
				};
			await deps.planControlManager.writeControlRequest("cancel", command.reason ?? "rerun requested");
			return {
				accepted: true,
				message: `Rerun request sent for plan ${command.planExecutionId}`,
			};
		case "retry_workspace":
			if (!deps.transitionRouter)
				return {
					accepted: false,
					message: "Transition router not available",
					error: "No transition router configured",
				};
			await deps.transitionRouter.transitionWorkspace(command.planExecutionId, command.workspaceId, "Pending", {
				reason: command.reason ?? "retry requested",
			});
			return {
				accepted: true,
				message: `Retry requested for workspace ${command.workspaceId}`,
			};
		case "request_user_escalation":
			return {
				accepted: true,
				message: `User escalation requested for workspace ${command.workspaceId}`,
			};
		case "approve_proposal":
			return { accepted: true, message: `Proposal ${command.proposalId} approved` };
		case "issue_human_directive": {
			if (!deps.planControlManager)
				return {
					accepted: false,
					message: "Plan control manager not available",
					error: "No plan control manager configured",
				};
			await deps.planControlManager.writeControlRequest(
				"human_directive",
				JSON.stringify({
					workspaceId: command.workspaceId,
					directive: command.directive,
					severity: command.severity ?? "medium",
					directiveId: command.directiveId,
				}),
			);
			return {
				accepted: true,
				message: `Human directive issued for workspace ${command.workspaceId}`,
			};
		}
		case "intervene_workspace": {
			if (!deps.planControlManager)
				return {
					accepted: false,
					message: "Plan control manager not available",
					error: "No plan control manager configured",
				};
			await deps.planControlManager.writeControlRequest(
				command.action,
				JSON.stringify({
					workspaceId: command.workspaceId,
					reason: command.reason,
				}),
			);
			return {
				accepted: true,
				message: `${command.action} intervention sent for workspace ${command.workspaceId}`,
			};
		}
		default:
			return {
				accepted: false,
				message: `Unknown command type: ${(command as any).type}`,
				error: "Unhandled command type",
			};
	}
}

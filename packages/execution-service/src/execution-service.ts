/**
 * Execution Service — P40 Platform / Agent Separation
 *
 * Higher-level service facade combining command and query handling.
 * External consumers interact with execution through this service.
 */
import type { ExecutionCommand, ExecutionReadModel } from "@earendil-works/pi-execution-core";
import { type CommandHandlerResult, handleExecutionCommand } from "./command-handler.js";
import { createExecutionReadModel } from "./query-handler.js";

export interface ExecutionService {
	executeCommand(
		command: ExecutionCommand,
		deps?: Parameters<typeof handleExecutionCommand>[1],
	): Promise<CommandHandlerResult>;
	getReadModel(stateStore: Parameters<typeof createExecutionReadModel>[0]): ExecutionReadModel;
}

export function createExecutionService(): ExecutionService {
	return {
		async executeCommand(
			command: ExecutionCommand,
			deps?: Parameters<typeof handleExecutionCommand>[1],
		): Promise<CommandHandlerResult> {
			return handleExecutionCommand(command, deps ?? {});
		},

		getReadModel(stateStore: Parameters<typeof createExecutionReadModel>[0]): ExecutionReadModel {
			return createExecutionReadModel(stateStore);
		},
	};
}

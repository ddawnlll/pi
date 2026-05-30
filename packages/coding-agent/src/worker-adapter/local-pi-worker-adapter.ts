/**
 * Local Pi Worker Adapter — P40 Platform / Agent Separation
 *
 * Wraps the existing WorkspaceAgentExecutor behind the WorkerAdapter boundary.
 * This is the default local worker adapter for Pi.
 */

import type { WorkspaceAgentExecutor } from "../core/workspace-agent-executor.js";
import type {
	WorkerAdapter,
	WorkerAdapterCapabilities,
	WorkerCommandHistoryEntry,
	WorkerRunRequest,
	WorkerRunResult,
} from "./types.js";

export interface LocalPiWorkerAdapterConfig {
	createExecutor: (request: WorkerRunRequest) => WorkspaceAgentExecutor;
}

export class LocalPiWorkerAdapter implements WorkerAdapter {
	private readonly createExecutor: (request: WorkerRunRequest) => WorkspaceAgentExecutor;
	private readonly activeExecutors = new Map<string, WorkspaceAgentExecutor>();

	constructor(config: LocalPiWorkerAdapterConfig) {
		this.createExecutor = config.createExecutor;
	}

	async run(request: WorkerRunRequest): Promise<WorkerRunResult> {
		const executor = this.createExecutor(request);
		this.activeExecutors.set(request.workspaceId, executor);

		try {
			const agentResult = await executor.execute(request.packet, request.workspaceId, {
				logPath: request.metadata?.logPath as string | undefined,
				attemptNo: request.attemptNumber,
			});

			const verdict = mapVerdict(agentResult.verdict);
			const commandHistory: WorkerCommandHistoryEntry[] = [];

			return {
				verdict,
				events: [],
				changedFiles: [],
				commandHistory,
				report: agentResult.report,
				error: agentResult.error,
				metadata: {
					success: agentResult.success,
					logCount: agentResult.logs.length,
				},
			};
		} finally {
			this.activeExecutors.delete(request.workspaceId);
		}
	}

	async abort(workspaceId: string): Promise<void> {
		const executor = this.activeExecutors.get(workspaceId);
		if (executor) {
			executor.abort();
		}
	}

	getCapabilities(): WorkerAdapterCapabilities {
		return {
			name: "local-pi",
			version: "1.0.0",
			supportsWorktree: true,
			supportsPatchTransaction: false,
			maxConcurrent: 0,
		};
	}
}

export function createLocalPiWorkerAdapter(
	createExecutor: (request: WorkerRunRequest) => WorkspaceAgentExecutor,
): LocalPiWorkerAdapter {
	return new LocalPiWorkerAdapter({ createExecutor });
}

function mapVerdict(agentVerdict: "COMPLETE" | "BLOCKED" | "FAILED"): WorkerRunResult["verdict"] {
	switch (agentVerdict) {
		case "COMPLETE": return "complete";
		case "BLOCKED": return "blocked";
		case "FAILED": return "failed";
		default: return "failed";
	}
}

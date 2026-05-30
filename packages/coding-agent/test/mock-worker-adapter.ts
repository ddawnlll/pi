/**
 * Mock WorkerAdapter — P40.1 Real Boundary Adoption
 *
 * A mock WorkerAdapter for testing that proves AutonomousExecutor
 * can run through the WorkerAdapter boundary without real agent execution.
 */
import type { WorkerAdapter, WorkerAdapterCapabilities, WorkerRunRequest, WorkerRunResult } from "../src/worker-adapter/types.js";

export interface MockWorkerAdapterConfig {
	/** Default verdict to return */
	defaultVerdict?: WorkerRunResult["verdict"];
	/** Custom handler for run requests */
	onRun?: (request: WorkerRunRequest) => Promise<WorkerRunResult>;
	/** Track abort calls */
	abortCalls?: string[];
}

export function createMockWorkerAdapter(config: MockWorkerAdapterConfig = {}): WorkerAdapter & { abortCalls: string[] } {
	const abortCalls: string[] = [];

	return {
		async run(request: WorkerRunRequest): Promise<WorkerRunResult> {
			if (config.onRun) {
				return config.onRun(request);
			}
			return {
				verdict: config.defaultVerdict ?? "complete",
				events: [],
				changedFiles: [],
				commandHistory: [],
				report: `Mock execution completed for workspace ${request.workspaceId}`,
			};
		},

		async abort(runId: string): Promise<void> {
			abortCalls.push(runId);
		},

		getCapabilities(): WorkerAdapterCapabilities {
			return {
				name: "mock-adapter",
				version: "0.0.0",
				supportsWorktree: false,
				supportsPatchTransaction: false,
				maxConcurrent: 1,
			};
		},

		abortCalls,
	};
}

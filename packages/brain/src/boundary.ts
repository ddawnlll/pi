/**
 * Brain Boundary — P40 Platform / Agent Separation
 */
import type { BrainProposal, ExecutionReadModel } from "@earendil-works/pi-execution-core";

export interface BrainBoundaryConfig {
	executionReadModel: ExecutionReadModel;
}

export class BrainBoundary {
	private readonly executionReadModel: ExecutionReadModel;
	constructor(config: BrainBoundaryConfig) {
		this.executionReadModel = config.executionReadModel;
	}
	get execution(): ExecutionReadModel {
		return this.executionReadModel;
	}
	createProposal(proposal: Omit<BrainProposal, "id">): BrainProposal {
		return { id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...proposal };
	}
}

export function createBrainBoundary(executionReadModel: ExecutionReadModel): BrainBoundary {
	return new BrainBoundary({ executionReadModel });
}

/**
 * Execution Query Handler — P40 Platform / Agent Separation
 */
import type {
	CommandHistoryView,
	ExecutionReadModel,
	FinalValidationView,
	JournalEventEnvelope,
	JournalQuery,
	LeadDirectiveView,
	PlanExecutionSummary,
	WorkspaceExecutionSummary,
} from "../execution-core/types.js";

export function createExecutionReadModel(stateStore: {
	getPlanExecutionSummary?(planExecutionId: string): Promise<PlanExecutionSummary | null>;
	getWorkspaceState?(planExecutionId: string, workspaceId: string): Promise<{ stage: string; attempts: number; startedAt?: number; completedAt?: number; error?: string; reportPath?: string } | null>;
	getJournalEvents?(planExecutionId: string, options?: { limit?: number; offset?: number; eventType?: string; workspaceId?: string }): Promise<JournalEventEnvelope[]>;
}): ExecutionReadModel {
	return {
		async getPlanSummary(planExecutionId: string): Promise<PlanExecutionSummary> {
			if (stateStore.getPlanExecutionSummary) {
				const summary = await stateStore.getPlanExecutionSummary(planExecutionId);
				if (summary) return summary;
			}
			return { id: planExecutionId, projectId: "default", phase: "unknown", title: "Unknown Plan", status: "running", startedAt: new Date().toISOString(), completedAt: null };
		},
		async getWorkspaceSummary(planExecutionId: string, workspaceId: string): Promise<WorkspaceExecutionSummary> {
			if (stateStore.getWorkspaceState) {
				const state = await stateStore.getWorkspaceState(planExecutionId, workspaceId);
				if (state) return { id: workspaceId, planExecutionId, workspaceId, stage: state.stage, attempts: state.attempts, startedAt: state.startedAt ? new Date(state.startedAt).toISOString() : undefined, completedAt: state.completedAt ? new Date(state.completedAt).toISOString() : undefined, error: state.error, reportPath: state.reportPath };
			}
			return { id: workspaceId, planExecutionId, workspaceId, stage: "unknown", attempts: 0 };
		},
		async listJournalEvents(planExecutionId: string, options?: JournalQuery): Promise<JournalEventEnvelope[]> {
			if (stateStore.getJournalEvents) return stateStore.getJournalEvents(planExecutionId, options);
			return [];
		},
		async getCommandHistory(): Promise<CommandHistoryView[]> { return []; },
		async getLeadDirectives(): Promise<LeadDirectiveView[]> { return []; },
		async getFinalValidationStatus(): Promise<FinalValidationView> { return { required: true, passed: null, blocked: false, blockReasons: [] }; },
	};
}

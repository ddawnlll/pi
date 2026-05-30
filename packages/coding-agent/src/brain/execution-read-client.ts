/**
 * Brain Execution Read Client — P40 Platform / Agent Separation
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

export class BrainExecutionReadClient {
	private readonly readModel: ExecutionReadModel;
	constructor(readModel: ExecutionReadModel) { this.readModel = readModel; }
	async getPlanSummary(planExecutionId: string): Promise<PlanExecutionSummary> { return this.readModel.getPlanSummary(planExecutionId); }
	async getWorkspaceSummary(planExecutionId: string, workspaceId: string): Promise<WorkspaceExecutionSummary> { return this.readModel.getWorkspaceSummary(planExecutionId, workspaceId); }
	async listJournalEvents(planExecutionId: string, options?: JournalQuery): Promise<JournalEventEnvelope[]> { return this.readModel.listJournalEvents(planExecutionId, options); }
	async getCommandHistory(planExecutionId: string, workspaceId: string): Promise<CommandHistoryView[]> { return this.readModel.getCommandHistory(planExecutionId, workspaceId); }
	async getLeadDirectives(planExecutionId: string, workspaceId: string): Promise<LeadDirectiveView[]> { return this.readModel.getLeadDirectives(planExecutionId, workspaceId); }
	async getFinalValidationStatus(planExecutionId: string, workspaceId: string): Promise<FinalValidationView> { return this.readModel.getFinalValidationStatus(planExecutionId, workspaceId); }
}

export function createBrainExecutionReadClient(readModel: ExecutionReadModel): BrainExecutionReadClient {
	return new BrainExecutionReadClient(readModel);
}
